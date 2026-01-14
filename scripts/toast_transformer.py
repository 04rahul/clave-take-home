"""
Toast POS Data Transformer
Transforms Toast POS order data into unified schema format using SQLAlchemy models
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
    map_toast_order_type,
    map_toast_status,
    format_order_id,
    extract_categories_from_toast_data,
    build_category_mapping_from_catalogs,
    ProductCategory,
    Order,
    OrderItem,
    ModelRegistry
)


def process_toast(file_path: Path, registry: ModelRegistry) -> None:
    """Process Toast POS data file and create model instances."""
    print(f"Processing Toast: {file_path}")
    
    try:
        # Track starting count
        start_count = len(registry.orders)
        
        with open(file_path, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        # Extract categories from Toast data and build comprehensive mapping
        toast_categories = extract_categories_from_toast_data(data, clean_text_func=clean_text)
        # Build and cache the comprehensive category mapping
        import models as m
        comprehensive_mapping = build_category_mapping_from_catalogs(
            toast_categories=toast_categories,
            clean_text_func=clean_text
        )
        # Cache it globally for normalize_category to use
        m._category_mapping_cache = comprehensive_mapping
        
        locations_data = data.get('locations', [])
        orders_data = data.get('orders', [])
        
        # Build location mapping from Toast data and create Location instances
        toast_location_map = {}  # guid -> canonical_name
        for loc in locations_data:
            guid = loc.get('guid')
            name = loc.get('name')
            timezone_str = loc.get('timezone', 'America/New_York')
            address = loc.get('address', {})
            
            if guid and name:
                toast_location_map[guid] = name
                # Create or get Location instance
                location = registry.get_or_create_location(
                    canonical_name=name,
                    source_system=SourceSystem.TOAST,
                    source_id=guid,
                    timezone_str=timezone_str,
                    address_line_1=address.get('line1'),
                    city=address.get('city'),
                    state=address.get('state'),
                    zip_code=address.get('zip'),
                    country=address.get('country', 'US')
                )
        
        for order in orders_data:
            # Toast orders contain checks (can be multiple checks per order)
            restaurant_guid = order.get('restaurantGuid')  # This is actually the location GUID
            
            # Get location name and instance
            location_name = toast_location_map.get(restaurant_guid)
            if not location_name:
                # Fallback to hardcoded mapping
                location_name = get_location_name(restaurant_guid, SourceSystem.TOAST.value)
                # Create location if it doesn't exist
                location = registry.get_or_create_location(
                    canonical_name=location_name,
                    source_system=SourceSystem.TOAST,
                    source_id=restaurant_guid
                )
            else:
                location = registry.locations[location_name]
            
            checks = order.get('checks', [])
            
            for check in checks:
                # Each check becomes an order in our unified schema
                check_guid = check.get('guid', '')
                order_id_str = format_order_id(SourceSystem.TOAST, check_guid)
                
                # Get payment info from check
                payments = check.get('payments', [])
                payment = payments[0] if payments else {}
                
                timestamp_utc = normalize_timestamp(check.get('paidDate') or check.get('closedDate') or order.get('openedDate'))
                
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
                
                # Use businessDate from source if available, otherwise use local timezone date
                business_date = pd.to_datetime(order.get('businessDate')).date() if order.get('businessDate') else timestamp_local.date()
                hour_of_day = timestamp_local.hour
                day_of_week = timestamp_local.weekday()  # 0=Monday, 6=Sunday (Python datetime)
                day_of_week = (day_of_week + 1) % 7  # Convert to 0=Sunday format
                
                # Determine order type from dining option using base_model
                dining_option = order.get('diningOption', {})
                dining_behavior = dining_option.get('behavior', 'DINE_IN')
                order_type = map_toast_order_type(dining_behavior)
                
                # Create Order instance
                order_instance = Order(
                    order_id=order_id_str,
                    source_system=SourceSystem.TOAST,
                    location=location,  # Use relationship, not location_id
                    external_order_id=order.get('guid', ''),
                    timestamp_utc=timestamp_utc,
                    business_date=business_date,
                    hour_of_day=hour_of_day,
                    day_of_week=day_of_week,
                    order_type=order_type,
                    total_amount_cents=to_cents(check.get('totalAmount', 0)),
                    subtotal_amount_cents=to_cents(check.get('amount', 0)),
                    tax_amount_cents=to_cents(check.get('taxAmount', 0)),
                    tip_amount_cents=to_cents(check.get('tipAmount', 0)),
                    net_revenue_cents=to_cents(check.get('amount', 0)),  # Net revenue = subtotal
                    fee_amount_cents=0,  # Toast doesn't have platform fees
                    payment_method=payment.get('type', 'UNKNOWN'),
                    card_brand=payment.get('cardType'),
                    status='COMPLETED' if not check.get('voided') else 'VOIDED'
                )
                registry.orders.append(order_instance)
                
                # Process items (selections)
                selections = check.get('selections', [])
                for selection in selections:
                    if selection.get('voided', False):
                        continue
                    
                    # Use displayName (what was shown to customer) as raw name, with fallback
                    raw_name = selection.get('displayName') or selection.get('item', {}).get('name', 'Unknown')
                    quantity = selection.get('quantity', 1)
                    clean_name, adj_qty = extract_baked_quantity(raw_name, quantity)
                    
                    # Get category from item group
                    item_group = selection.get('itemGroup', {})
                    category_str = normalize_category(item_group.get('name', 'unknown'), clean_text_func=clean_text)
                    try:
                        category_enum = ProductCategory(category_str)
                    except ValueError:
                        category_enum = ProductCategory.UNKNOWN
                    
                    # Product will be created after entity resolution
                    
                    # Toast price field is the TOTAL line item price, not unit price
                    total_line_price = to_cents(selection.get('price', 0))
                    
                    # If quantity was extracted from name, adjust unit price
                    if adj_qty > quantity:
                        # Quantity was extracted from name, calculate unit price per actual item
                        unit_price = total_line_price // adj_qty if adj_qty > 0 else 0
                    else:
                        # No quantity extraction, calculate unit price from total
                        unit_price = total_line_price // quantity if quantity > 0 else total_line_price
                    
                    # Total price is the original line item price from Toast
                    total_price = total_line_price
                    
                    # Create OrderItem instance
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
        toast_order_count = len(registry.orders) - start_count
        print(f"  Processed {toast_order_count} orders from Toast")

    except Exception as e:
        print(f"Error processing Toast: {e}")
        import traceback
        traceback.print_exc()

