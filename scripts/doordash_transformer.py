"""
DoorDash Data Transformer
Transforms DoorDash order data into unified schema format using SQLAlchemy models
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
    normalize_category,
    map_doordash_order_type,
    map_doordash_status,
    extract_categories_from_doordash_data,
    build_category_mapping_from_catalogs,
    ProductCategory,
    Order,
    OrderItem,
    ModelRegistry
)


def process_doordash(file_path: Path, registry: ModelRegistry) -> None:
    """Process DoorDash data file and create model instances."""
    print(f"Processing DoorDash: {file_path}")
    
    try:
        # Track starting count
        start_count = len(registry.orders)
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract categories from DoorDash data and build comprehensive mapping
        doordash_categories = extract_categories_from_doordash_data(data, clean_text_func=clean_text)
        # Build and cache the comprehensive category mapping
        import models as m
        comprehensive_mapping = build_category_mapping_from_catalogs(
            doordash_categories=doordash_categories,
            clean_text_func=clean_text
        )
        # Cache it globally for normalize_category to use
        m._category_mapping_cache = comprehensive_mapping
        
        # Extract stores and create Location instances
        stores_data = data.get('stores', [])
        store_location_map = {}  # store_id -> canonical_name
        for store in stores_data:
            store_id = store.get('store_id')
            store_name = store.get('name')
            timezone_str = store.get('timezone', 'America/New_York')
            address = store.get('address', {})
            
            if store_id and store_name:
                store_location_map[store_id] = store_name
                # Create or get Location instance
                location = registry.get_or_create_location(
                    canonical_name=store_name,
                    source_system=SourceSystem.DOORDASH,
                    source_id=store_id,
                    timezone_str=timezone_str,
                    address_line_1=address.get('street'),
                    city=address.get('city'),
                    state=address.get('state'),
                    zip_code=address.get('zip_code'),
                    country=address.get('country', 'US')
                )
        
        orders_data = data.get('orders', [])
        
        for order in orders_data:
            external_id = order.get('external_delivery_id', '')
            order_id_str = f"DD_{external_id}"
            
            store_id = order.get('store_id', '')
            location_name = store_location_map.get(store_id) or get_location_name(store_id, "DoorDash")
            
            # Get or create location instance
            if location_name not in registry.locations:
                location = registry.get_or_create_location(
                    canonical_name=location_name,
                    source_system=SourceSystem.DOORDASH,
                    source_id=store_id
                )
            else:
                location = registry.locations[location_name]
            
            timestamp_utc = normalize_timestamp(order.get('created_at'))
            
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
            
            business_date = timestamp_local.date()  # Use local timezone date as business date
            hour_of_day = timestamp_local.hour
            day_of_week = timestamp_local.weekday()  # 0=Monday, 6=Sunday (Python datetime)
            day_of_week = (day_of_week + 1) % 7  # Convert to 0=Sunday format
            
            # DoorDash order type mapping
            fulfillment_method = order.get('order_fulfillment_method', 'MERCHANT_DELIVERY')
            order_type = map_doordash_order_type(fulfillment_method)
            
            # Map DoorDash statuses using base_model
            door_dash_status = order.get('order_status', 'DELIVERED')
            status = map_doordash_status(door_dash_status)
            
            # Create Order instance
            order_instance = Order(
                order_id=order_id_str,
                source_system=SourceSystem.DOORDASH,
                location=location,  # Use relationship
                external_order_id=external_id,
                timestamp_utc=timestamp_utc,
                business_date=business_date,
                hour_of_day=hour_of_day,
                day_of_week=day_of_week,
                order_type=order_type,
                total_amount_cents=to_cents(order.get('total_charged_to_consumer', 0)),
                subtotal_amount_cents=to_cents(order.get('order_subtotal', 0)),
                tax_amount_cents=to_cents(order.get('tax_amount', 0)),
                tip_amount_cents=to_cents(order.get('dasher_tip', 0)),
                net_revenue_cents=to_cents(order.get('merchant_payout', 0)),  # Net revenue = merchant payout
                fee_amount_cents=to_cents(order.get('commission', 0)),
                payment_method='CREDIT',  # DoorDash orders are always card
                card_brand=None,
                status=status
            )
            registry.orders.append(order_instance)
            
            # Process items
            order_items = order.get('order_items', [])
            for item in order_items:
                raw_name = item.get('name', 'Unknown')
                quantity = item.get('quantity', 1)
                clean_name, adj_qty = extract_baked_quantity(raw_name, quantity)
                
                # Use base_model normalize_category with clean_text function
                category_str = normalize_category(item.get('category', 'unknown'), clean_text_func=clean_text)
                try:
                    category_enum = ProductCategory(category_str)
                except ValueError:
                    category_enum = ProductCategory.UNKNOWN
                
                # DoorDash provides unit_price per item and total_price for the line item
                # Use total_price as source of truth for consistency
                total_price = to_cents(item.get('total_price', 0))
                if adj_qty > quantity:
                    # Quantity was extracted from name, calculate unit price per actual item
                    unit_price = total_price // adj_qty if adj_qty > 0 else 0
                else:
                    # No quantity extraction, calculate unit price from total_price
                    # This ensures consistency even if source unit_price has rounding differences
                    unit_price = total_price // quantity if quantity > 0 else total_price
                
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
        doordash_order_count = len(registry.orders) - start_count
        print(f"  Processed {doordash_order_count} orders from DoorDash")

    except Exception as e:
        print(f"Error processing DoorDash: {e}")
        import traceback
        traceback.print_exc()

