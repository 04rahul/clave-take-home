"""
Square POS Data Transformer
Transforms Square POS order data into unified schema format using SQLAlchemy models
"""
import json
import pandas as pd
from pathlib import Path
from typing import Dict, List
from datetime import timezone
import pytz

# Import from consolidated modules
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).parent))
from process_data import (
    normalize_timestamp,
    extract_baked_quantity,
    to_cents,
    clean_text
)
from models import (
    SourceSystem,
    get_location_name,
    normalize_category as base_normalize_category,
    map_square_order_type,
    map_square_status,
    extract_categories_from_square_catalog,
    build_category_mapping_from_catalogs,
    ProductCategory,
    Order,
    OrderItem,
    ModelRegistry
)


def process_square(orders_path: Path, catalog_path: Path, locations_path: Path, 
                   payments_path: Path, registry: ModelRegistry) -> None:
    """Process Square POS data files and create model instances."""
    print(f"Processing Square: {orders_path}")
    
    try:
        # Track starting count
        start_count = len(registry.orders)
        
        # Load catalog for item name lookups
        catalog_map = {}
        category_map = {}
        item_category_map = {}  # Map item_id -> category_id for variations
        
        with open(catalog_path, 'r', encoding='utf-8') as f:
            catalog_data = json.load(f)
        
        # Extract categories from catalog and build comprehensive mapping
        square_categories = extract_categories_from_square_catalog(catalog_data, clean_text_func=clean_text)
        # Build and cache the comprehensive category mapping
        import models as m
        comprehensive_mapping = build_category_mapping_from_catalogs(
            square_categories=square_categories,
            clean_text_func=clean_text
        )
        # Cache it globally for normalize_category to use
        m._category_mapping_cache = comprehensive_mapping
        
        objects = catalog_data.get('objects', [])
        
        # First pass: Build category map (ID -> name) and item category map
        for obj in objects:
            obj_type = obj.get('type')
            
            if obj_type == 'CATEGORY':
                cat_id = obj.get('id')
                cat_data = obj.get('category_data', {})
                cat_name = cat_data.get('name', '')
                if cat_id:
                    category_map[cat_id] = cat_name
            
            elif obj_type == 'ITEM':
                item_id = obj.get('id')
                item_data = obj.get('item_data', {})
                category_id = item_data.get('category_id')
                
                # Store item -> category mapping for variations
                if item_id and category_id:
                    item_category_map[item_id] = category_id
        
        # Second pass: Build catalog map (items and variations)
        for obj in objects:
            obj_type = obj.get('type')
            
            if obj_type == 'ITEM':
                item_id = obj.get('id')
                item_data = obj.get('item_data', {})
                name = item_data.get('name', '')
                category_id = item_data.get('category_id')
                
                if item_id:
                    catalog_map[item_id] = {
                        'name': name,
                        'category_id': category_id,
                    }
                
                # Map variations (variations inherit category from parent item)
                variations = item_data.get('variations', [])
                for var in variations:
                    var_id = var.get('id')
                    if var_id:
                        # Variations use parent item's category
                        var_category_id = category_id or item_category_map.get(item_id)
                        catalog_map[var_id] = {
                            'name': name,  # Use item name, variation is just size/flavor
                            'category_id': var_category_id,
                        }
        
        # Load locations and create Location instances
        with open(locations_path, 'r', encoding='utf-8') as f:
            locations_data = json.load(f)
        
        square_location_map = {}  # loc_id -> canonical_name
        for loc in locations_data.get('locations', []):
            loc_id = loc.get('id')
            loc_name = loc.get('name')
            timezone_str = loc.get('timezone', 'America/New_York')
            address = loc.get('address', {})
            
            if loc_id and loc_name:
                square_location_map[loc_id] = loc_name
                # Create or get Location instance
                location = registry.get_or_create_location(
                    canonical_name=loc_name,
                    source_system=SourceSystem.SQUARE,
                    source_id=loc_id,
                    timezone_str=timezone_str,
                    address_line_1=address.get('address_line_1'),
                    city=address.get('locality'),
                    state=address.get('administrative_district_level_1'),
                    zip_code=address.get('postal_code'),
                    country=address.get('country', 'US')
                )
        
        # Load payments for payment method info
        payments_map = {}
        with open(payments_path, 'r', encoding='utf-8') as f:
            payments_data = json.load(f)
        
        for payment in payments_data.get('payments', []):
            order_id = payment.get('order_id')
            if order_id:
                payments_map[order_id] = {
                    'method': payment.get('source_type', 'UNKNOWN'),
                    'card_brand': payment.get('card_details', {}).get('card', {}).get('card_brand'),
                    'last4': payment.get('card_details', {}).get('card', {}).get('last_4'),
                }
        
        # Process orders
        with open(orders_path, 'r', encoding='utf-8') as f:
            orders_data = json.load(f)
        
        orders_list_data = orders_data.get('orders', [])
        
        for order in orders_list_data:
            order_sq_id = order.get('id', '')
            order_id_str = f"SQ_{order_sq_id}"
            
            location_sq_id = order.get('location_id', '')
            location_name = square_location_map.get(location_sq_id, get_location_name(location_sq_id, "Square"))
            
            # Get or create location instance
            if location_name not in registry.locations:
                location = registry.get_or_create_location(
                    canonical_name=location_name,
                    source_system=SourceSystem.SQUARE,
                    source_id=location_sq_id
                )
            else:
                location = registry.locations[location_name]
            
            timestamp_utc = normalize_timestamp(order.get('created_at'))
            closed_at = order.get('closed_at')
            if closed_at:
                timestamp_utc = normalize_timestamp(closed_at)
            
            # Convert UTC to local timezone for business_date, hour_of_day and day_of_week
            # normalize_timestamp() already returns UTC-aware datetime
            tz_str = location.timezone or 'America/New_York'
            try:
                tz = pytz.timezone(tz_str)
                # Convert from UTC (timezone.utc) to local timezone
                # If timestamp_utc has timezone.utc, convert to naive first, then localize with pytz
                if timestamp_utc.tzinfo == timezone.utc:
                    # Convert Python's timezone.utc to pytz UTC, then to local
                    utc_naive = timestamp_utc.replace(tzinfo=None)
                    utc_pytz = pytz.UTC.localize(utc_naive)
                    timestamp_local = utc_pytz.astimezone(tz)
                elif timestamp_utc.tzinfo is None:
                    # No timezone, assume UTC and localize
                    utc_pytz = pytz.UTC.localize(timestamp_utc)
                    timestamp_local = utc_pytz.astimezone(tz)
                else:
                    # Already has timezone, convert directly
                    timestamp_local = timestamp_utc.astimezone(tz)
            except Exception as e:
                print(f"Warning: Timezone conversion failed for {tz_str}: {e}")
                timestamp_local = timestamp_utc
            
            business_date = timestamp_local.date()  # Use local timezone date
            hour_of_day = timestamp_local.hour
            day_of_week = timestamp_local.weekday()  # 0=Monday, 6=Sunday (Python datetime)
            day_of_week = (day_of_week + 1) % 7  # Convert to 0=Sunday format
            
            # Order type from fulfillments
            fulfillments = order.get('fulfillments', [])
            order_type = 'DINE_IN'  # Default
            if fulfillments:
                fulfillment = fulfillments[0]
                fulfillment_type = fulfillment.get('type', '')
                if fulfillment_type == 'PICKUP':
                    order_type = 'TAKE_OUT'
                elif fulfillment_type == 'DELIVERY' or 'DELIVERY' in fulfillment_type.upper():
                    order_type = 'DELIVERY'
                elif fulfillment_type == 'DINE_IN' or 'DINE' in fulfillment_type.upper():
                    order_type = 'DINE_IN'
            
            # Money amounts
            total_money = order.get('total_money', {})
            tax_money = order.get('total_tax_money', {})
            tip_money = order.get('total_tip_money', {})
            
            total_amount = to_cents(total_money.get('amount', 0))
            tax_amount = to_cents(tax_money.get('amount', 0))
            tip_amount = to_cents(tip_money.get('amount', 0))
            
            # Subtotal = total - tax - tip
            subtotal = total_amount - tax_amount - tip_amount
            net_revenue = subtotal  # Square doesn't charge platform fees
            
            # Get payment info
            payment_info = payments_map.get(order_sq_id, {})
            
            # Map Square status using base_model
            square_state = order.get('state', 'COMPLETED')
            status = map_square_status(square_state)
            
            # Create Order instance
            order_instance = Order(
                order_id=order_id_str,
                source_system=SourceSystem.SQUARE,
                location=location,  # Use relationship
                external_order_id=order_sq_id,
                timestamp_utc=timestamp_utc,
                business_date=business_date,
                hour_of_day=hour_of_day,
                day_of_week=day_of_week,
                order_type=order_type,
                total_amount_cents=total_amount,
                subtotal_amount_cents=subtotal,
                tax_amount_cents=tax_amount,
                tip_amount_cents=tip_amount,
                net_revenue_cents=net_revenue,
                fee_amount_cents=0,
                payment_method=payment_info.get('method', 'UNKNOWN'),
                card_brand=payment_info.get('card_brand'),
                status=status
            )
            registry.orders.append(order_instance)
            
            # Process line items
            line_items = order.get('line_items', [])
            for line_item in line_items:
                # Try to get name from catalog
                catalog_obj_id = line_item.get('catalog_object_id')
                raw_name = "Unknown Item"
                category_id = None
                
                if catalog_obj_id and catalog_obj_id in catalog_map:
                    catalog_item = catalog_map[catalog_obj_id]
                    raw_name = catalog_item.get('name', 'Unknown Item')
                    category_id = catalog_item.get('category_id')
                else:
                    # Fallback to name in line item (if available)
                    raw_name = line_item.get('name', 'Unknown Item')
                
                # Get category name from category_id using base_model
                category_str = "unknown"
                if category_id and category_id in category_map:
                    cat_name = category_map[category_id]
                    category_str = base_normalize_category(cat_name, clean_text_func=clean_text)
                
                try:
                    category_enum = ProductCategory(category_str)
                except ValueError:
                    category_enum = ProductCategory.UNKNOWN
                
                quantity_str = line_item.get('quantity', '1')
                quantity = int(float(quantity_str))  # Square uses string quantities
                clean_name, adj_qty = extract_baked_quantity(raw_name, quantity)
                
                # Get price from money object
                gross_sales = line_item.get('gross_sales_money', {})
                total_line_price = to_cents(gross_sales.get('amount', 0))
                
                # Calculate unit price per actual item
                if adj_qty > 0:
                    unit_price = total_line_price // adj_qty
                else:
                    unit_price = total_line_price // quantity if quantity > 0 else total_line_price

                # Total price is what was actually charged (total_line_price)
                total_price = total_line_price

                # Create OrderItem instance (product will be set after entity resolution)
                order_item = OrderItem(
                    order=order_instance,  # Use relationship
                    product=None,  # Will be set after entity resolution
                    item_name=raw_name,
                    canonical_name=clean_name,
                    category=category_enum,
                    quantity=adj_qty,
                    unit_price_cents=unit_price,
                    total_price_cents=total_price
                )
                registry.order_items.append(order_item)
        
        # Calculate how many orders we added in this batch
        square_order_count = len(registry.orders) - start_count
        print(f"  Processed {square_order_count} orders from Square")

    except Exception as e:
        print(f"Error processing Square: {e}")
        import traceback
        traceback.print_exc()

