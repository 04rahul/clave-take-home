"""
Consolidated Models Module
Combines base_model, database_models, model_registry, and database connection utilities
"""

# ============================================
# IMPORTS
# ============================================
from typing import Dict, Set, List, Optional, Callable, Tuple
from enum import Enum
from datetime import datetime, timezone, date
from uuid import uuid4
import os
import pytz

from sqlalchemy import Column, String, Integer, DateTime, Date, Enum as SQLEnum, ForeignKey, Text, CheckConstraint, Boolean, create_engine, event
from sqlalchemy.dialects.postgresql import UUID, ENUM
from sqlalchemy.types import TypeDecorator
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import relationship, sessionmaker, Session
from sqlalchemy.pool import NullPool
from dotenv import load_dotenv


# ============================================
# ENUMS (from base_model.py)
# ============================================

class OrderType(str, Enum):
    """Order fulfillment types."""
    DINE_IN = "DINE_IN"
    TAKE_OUT = "TAKE_OUT"
    PICKUP = "PICKUP"
    DELIVERY = "DELIVERY"


class SourceSystem(str, Enum):
    """Source system identifiers."""
    TOAST = "Toast"
    DOORDASH = "DoorDash"
    SQUARE = "Square"


class OrderStatus(str, Enum):
    """Order status values."""
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    REFUNDED = "REFUNDED"
    VOIDED = "VOIDED"
    DELIVERED = "DELIVERED"
    FULFILLED = "FULFILLED"


class ProductCategory(str, Enum):
    """Product category values."""
    BURGERS = "burgers"
    SANDWICHES = "sandwiches"
    SIDES = "sides"
    APPETIZERS = "appetizers"
    BEVERAGES = "beverages"
    BREAKFAST = "breakfast"
    ENTREES = "entrees"
    SALADS = "salads"
    DESSERTS = "desserts"
    ALCOHOL = "alcohol"
    UNKNOWN = "unknown"


# ============================================
# LOCATION MAPPING
# ============================================

LOCATION_MAPPING: Dict[str, str] = {
    # Toast
    "loc_downtown_001": "Downtown",
    "loc_airport_002": "Airport",
    "loc_mall_003": "Mall Location",
    "loc_univ_004": "University",
    # DoorDash
    "str_downtown_001": "Downtown",
    "str_airport_002": "Airport",
    "str_mall_003": "Mall Location",
    "str_university_004": "University",
    # Square
    "LCN001DOWNTOWN": "Downtown",
    "LCN002AIRPORT": "Airport",
    "LCN003MALL": "Mall Location",
    "LCN004UNIV": "University",
}

# ============================================
# CATEGORY NORMALIZATION MAP
# ============================================

CATEGORY_MAP: Dict[str, str] = {
    "burgers": ProductCategory.BURGERS.value,
    "burger": ProductCategory.BURGERS.value,
    "sandwiches": ProductCategory.SANDWICHES.value,
    "sandwich": ProductCategory.SANDWICHES.value,
    "sides": ProductCategory.SIDES.value,
    "side": ProductCategory.SIDES.value,
    "sides & appetizers": ProductCategory.SIDES.value,
    "appetizers": ProductCategory.APPETIZERS.value,
    "appetizer": ProductCategory.APPETIZERS.value,
    "appitizers": ProductCategory.APPETIZERS.value,  # Fix typo
    "beverages": ProductCategory.BEVERAGES.value,
    "beverage": ProductCategory.BEVERAGES.value,
    "drinks": ProductCategory.BEVERAGES.value,
    "drink": ProductCategory.BEVERAGES.value,
    "coffee": ProductCategory.BEVERAGES.value,
    "breakfast": ProductCategory.BREAKFAST.value,
    "entrees": ProductCategory.ENTREES.value,
    "entree": ProductCategory.ENTREES.value,
    "pasta": ProductCategory.ENTREES.value,
    "seafood": ProductCategory.ENTREES.value,
    "salads": ProductCategory.SALADS.value,
    "salad": ProductCategory.SALADS.value,
    "desserts": ProductCategory.DESSERTS.value,
    "dessert": ProductCategory.DESSERTS.value,
    "alcohol": ProductCategory.ALCOHOL.value,
    "beer": ProductCategory.ALCOHOL.value,
    "beer & wine": ProductCategory.ALCOHOL.value,
    "wine": ProductCategory.ALCOHOL.value,
    "cocktails": ProductCategory.ALCOHOL.value,
    "wraps": ProductCategory.SANDWICHES.value,
}

# Base category map - used as foundation for comprehensive mapping
BASE_CATEGORY_MAP: Dict[str, str] = CATEGORY_MAP.copy()

# Global category mapping (can be initialized at runtime)
_category_mapping_cache: Optional[Dict[str, str]] = None


# ============================================
# DATABASE CONNECTION (from database.py)
# ============================================

# Load environment variables from .env file
# Look for .env in project root (parent of scripts directory)
from pathlib import Path
env_path = Path(__file__).parent.parent / '.env'
if env_path.exists():
    load_dotenv(env_path)
else:
    # Also try .env in scripts directory
    load_dotenv(Path(__file__).parent / '.env')

# Database connection - set via environment variable or default to local
DATABASE_URL = os.getenv('DATABASE_URL') or os.getenv('POSTGRES_URL') or \
               "postgresql://postgres:postgres@localhost:5432/clave_assessment"

# Global engine and session factory
_engine = None
_SessionLocal = None


def get_engine():
    """Get or create SQLAlchemy engine with SSL support for Supabase."""
    global _engine
    
    if _engine is None:
        # Detect if this is a Supabase connection (remote)
        is_remote = 'supabase.co' in DATABASE_URL if DATABASE_URL else False
        
        if is_remote:
            # Supabase requires SSL
            _engine = create_engine(
                DATABASE_URL,
                connect_args={"sslmode": "require"},
                poolclass=NullPool  # Use NullPool for Supabase to avoid connection issues
            )
        else:
            # Local PostgreSQL - no SSL
            _engine = create_engine(
                DATABASE_URL,
                poolclass=NullPool
            )
    
    return _engine


def get_session_factory():
    """Get or create session factory."""
    global _SessionLocal
    
    if _SessionLocal is None:
        engine = get_engine()
        _SessionLocal = sessionmaker(bind=engine, autocommit=False, autoflush=False)
    
    return _SessionLocal


def get_db_session() -> Session:
    """Get a database session (context manager)."""
    SessionLocal = get_session_factory()
    return SessionLocal()


# ============================================
# SQLALCHEMY MODELS (from database_models.py)
# ============================================

Base = declarative_base()


# TypeDecorator to ensure enum values (not names) are used
class ProductCategoryType(TypeDecorator):
    """Ensures ProductCategory enum values (lowercase strings) are used."""
    impl = String
    cache_ok = True
    
    def load_dialect_impl(self, dialect):
        # Always use String as impl to ensure process_bind_param is called
        # PostgreSQL will accept the lowercase string value for the ENUM column
        return String()
    
    def process_bind_param(self, value, dialect):
        """Convert enum to its value (lowercase string) before sending to database."""
        if value is None:
            return None
        if isinstance(value, ProductCategory):
            return value.value  # Return "burgers", not "BURGERS"
        if isinstance(value, str):
            # Handle case where enum name might be passed (e.g., "BURGERS")
            try:
                enum_obj = ProductCategory[value.upper()]
                return enum_obj.value  # Convert "BURGERS" -> "burgers"
            except (KeyError, AttributeError):
                # Already a value or invalid, return lowercase
                return value.lower()
        # For any other type, try to get the value
        try:
            if hasattr(value, 'value'):
                return value.value.lower() if isinstance(value.value, str) else str(value.value).lower()
            if hasattr(value, 'name'):
                enum_obj = ProductCategory[value.name]
                return enum_obj.value
        except (KeyError, AttributeError, TypeError):
            pass
        return str(value).lower() if value else None
    
    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return ProductCategory(value)
        except ValueError:
            return ProductCategory.UNKNOWN


class SourceSystemType(TypeDecorator):
    """Ensures SourceSystem enum values are used."""
    impl = String
    cache_ok = True
    
    def load_dialect_impl(self, dialect):
        # Always use String as impl to ensure process_bind_param is called
        # PostgreSQL will accept the string value for the ENUM column
        return String()
    
    def process_bind_param(self, value, dialect):
        """Convert enum to its value before sending to database."""
        if value is None:
            return None
        if isinstance(value, SourceSystem):
            return value.value
        if isinstance(value, str):
            try:
                enum_obj = SourceSystem[value]
                return enum_obj.value
            except (KeyError, AttributeError):
                return value
        return str(value) if value else None
    
    def process_result_value(self, value, dialect):
        if value is None:
            return None
        try:
            return SourceSystem(value)
        except ValueError:
            return SourceSystem.TOAST


class Location(Base):
    """SQLAlchemy model for locations table."""
    __tablename__ = 'locations'
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    canonical_name = Column(String(100), nullable=False, unique=True)
    toast_id = Column(String(50))
    doordash_id = Column(String(50))
    square_id = Column(String(50))
    address_line_1 = Column(String(255))
    city = Column(String(100))
    state = Column(String(50))
    zip_code = Column(String(20))
    country = Column(String(2), default='US')
    timezone = Column(String(50), default='America/New_York')
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    orders = relationship("Order", back_populates="location")


class Order(Base):
    """SQLAlchemy model for orders table."""
    __tablename__ = 'orders'
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id = Column(String(100), nullable=False, unique=True)
    source_system = Column(SourceSystemType(), nullable=False)
    location_id = Column(UUID(as_uuid=True), ForeignKey('locations.id', ondelete='RESTRICT'), nullable=False)
    external_order_id = Column(String(100))
    timestamp_utc = Column(DateTime(timezone=True), nullable=False)
    business_date = Column(Date, nullable=False)
    hour_of_day = Column(Integer)
    day_of_week = Column(Integer)
    # order_type is VARCHAR with CHECK constraint (not ENUM in schema)
    order_type = Column(String(20), nullable=False)
    total_amount_cents = Column(Integer, nullable=False, default=0)
    subtotal_amount_cents = Column(Integer, nullable=False, default=0)
    tax_amount_cents = Column(Integer, nullable=False, default=0)
    tip_amount_cents = Column(Integer, nullable=False, default=0)
    net_revenue_cents = Column(Integer, nullable=False, default=0)
    fee_amount_cents = Column(Integer, default=0)
    payment_method = Column(String(50))
    card_brand = Column(String(50))
    status = Column(String(50), default='COMPLETED')
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    location = relationship("Location", back_populates="orders")
    order_items = relationship("OrderItem", back_populates="order", cascade="all, delete-orphan")


class Product(Base):
    """SQLAlchemy model for products table."""
    __tablename__ = 'products'
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    canonical_name = Column(String(200), nullable=False)
    category = Column(ProductCategoryType(), nullable=False)
    description = Column(Text)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    order_items = relationship("OrderItem", back_populates="product")
    
    __table_args__ = (
        {'comment': 'Unique constraint on (canonical_name, category) should be in schema'},
    )


class OrderItem(Base):
    """SQLAlchemy model for order_items table."""
    __tablename__ = 'order_items'
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    order_id = Column(UUID(as_uuid=True), ForeignKey('orders.id', ondelete='CASCADE'), nullable=False)
    product_id = Column(UUID(as_uuid=True), ForeignKey('products.id', ondelete='SET NULL'))
    item_name = Column(String(200), nullable=False)
    canonical_name = Column(String(200), nullable=False)
    category = Column(ProductCategoryType(), nullable=False)
    quantity = Column(Integer, nullable=False, default=1)
    unit_price_cents = Column(Integer, nullable=False, default=0)
    total_price_cents = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    
    # Relationships
    order = relationship("Order", back_populates="order_items")
    product = relationship("Product", back_populates="order_items")


class LLMInteraction(Base):
    """SQLAlchemy model for llm_interactions table."""
    __tablename__ = 'llm_interactions'
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid4)
    user_prompt = Column(Text, nullable=False)
    llm_response = Column(Text)  # JSON string of LLM response
    error_details = Column(Text, nullable=True)
    success_status = Column(Boolean, nullable=False)
    agent_answered = Column(Boolean, nullable=False)
    step_failed = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    response_time_ms = Column(Integer, nullable=True)


# ============================================
# MODEL REGISTRY (from model_registry.py)
# ============================================

class ModelRegistry:
    """Registry to manage model instances during transformation."""
    
    def __init__(self):
        self.locations: Dict[str, Location] = {}  # canonical_name -> Location
        self.products: Dict[Tuple[str, ProductCategory], Product] = {}  # (name, category) -> Product
        self.orders: list[Order] = []
        self.order_items: list[OrderItem] = []
        
        # Metadata for locations (address, timezone, source IDs)
        self.location_metadata: Dict[str, dict] = {}
    
    def get_or_create_location(
        self,
        canonical_name: str,
        source_system: SourceSystem,
        source_id: str,
        timezone_str: str = 'America/New_York',
        address_line_1: Optional[str] = None,
        city: Optional[str] = None,
        state: Optional[str] = None,
        zip_code: Optional[str] = None,
        country: str = 'US'
    ) -> Location:
        """
        Get existing location or create new one.
        Updates metadata if location already exists.
        """
        if canonical_name not in self.locations:
            location = Location(
                canonical_name=canonical_name,
                timezone=timezone_str,
                address_line_1=address_line_1,
                city=city,
                state=state,
                zip_code=zip_code,
                country=country
            )
            self.locations[canonical_name] = location
            
            # Initialize metadata
            self.location_metadata[canonical_name] = {
                'toast_id': None,
                'doordash_id': None,
                'square_id': None,
                'timezone': timezone_str,
                'address_line_1': address_line_1,
                'city': city,
                'state': state,
                'zip_code': zip_code,
                'country': country,
            }
        else:
            location = self.locations[canonical_name]
        
        # Update source ID and metadata
        if source_system == SourceSystem.TOAST:
            location.toast_id = source_id
            self.location_metadata[canonical_name]['toast_id'] = source_id
        elif source_system == SourceSystem.DOORDASH:
            location.doordash_id = source_id
            self.location_metadata[canonical_name]['doordash_id'] = source_id
        elif source_system == SourceSystem.SQUARE:
            location.square_id = source_id
            self.location_metadata[canonical_name]['square_id'] = source_id
        
        # Update address fields if provided and not already set
        if address_line_1 and not location.address_line_1:
            location.address_line_1 = address_line_1
            self.location_metadata[canonical_name]['address_line_1'] = address_line_1
        if city and not location.city:
            location.city = city
            self.location_metadata[canonical_name]['city'] = city
        if state and not location.state:
            location.state = state
            self.location_metadata[canonical_name]['state'] = state
        if zip_code and not location.zip_code:
            location.zip_code = zip_code
            self.location_metadata[canonical_name]['zip_code'] = zip_code
        if timezone_str and location.timezone == 'America/New_York' and timezone_str != 'America/New_York':
            location.timezone = timezone_str
            self.location_metadata[canonical_name]['timezone'] = timezone_str
        
        return location
    
    def get_or_create_product(
        self,
        canonical_name: str,
        category: ProductCategory
    ) -> Product:
        """Get existing product or create new one."""
        key = (canonical_name, category)
        if key not in self.products:
            # Create product - TypeDecorator should convert enum to value
            # But to be safe, we ensure category is a ProductCategory enum object
            product = Product(
                canonical_name=canonical_name,
                category=category if isinstance(category, ProductCategory) else ProductCategory(category)
            )
            self.products[key] = product
        return self.products[key]
    
    def get_location_timezone_map(self) -> Dict[str, str]:
        """Get timezone mapping for locations."""
        return {
            name: meta.get('timezone', 'America/New_York')
            for name, meta in self.location_metadata.items()
        }


# ============================================
# CATEGORY EXTRACTION AND MAPPING (from base_model.py)
# ============================================

def extract_categories_from_square_catalog(catalog_data: Dict, clean_text_func: Optional[Callable[[str], str]] = None) -> Set[str]:
    """
    Extract unique category names from Square catalog.json.
    
    Args:
        catalog_data: Parsed JSON from Square catalog.json
        clean_text_func: Optional function to clean category names (removes emojis, etc.)
    
    Returns:
        Set of cleaned category names
    """
    categories = set()
    objects = catalog_data.get('objects', [])
    
    for obj in objects:
        if obj.get('type') == 'CATEGORY':
            cat_data = obj.get('category_data', {})
            cat_name = cat_data.get('name', '')
            if cat_name:
                if clean_text_func:
                    cleaned = clean_text_func(cat_name)
                else:
                    cleaned = cat_name.lower().strip()
                if cleaned:
                    categories.add(cleaned)
    
    return categories


def extract_categories_from_toast_data(toast_data: Dict, clean_text_func: Optional[Callable[[str], str]] = None) -> Set[str]:
    """
    Extract unique itemGroup names from Toast data.
    
    Args:
        toast_data: Parsed JSON from toast_pos_export.json
        clean_text_func: Optional function to clean category names (removes emojis, etc.)
    
    Returns:
        Set of cleaned itemGroup names
    """
    categories = set()
    orders = toast_data.get('orders', [])
    
    for order in orders:
        checks = order.get('checks', [])
        for check in checks:
            selections = check.get('selections', [])
            for selection in selections:
                item_group = selection.get('itemGroup', {})
                group_name = item_group.get('name', '')
                if group_name:
                    if clean_text_func:
                        cleaned = clean_text_func(group_name)
                    else:
                        cleaned = group_name.lower().strip()
                    if cleaned:
                        categories.add(cleaned)
    
    return categories


def extract_categories_from_doordash_data(doordash_data: Dict, clean_text_func: Optional[Callable[[str], str]] = None) -> Set[str]:
    """
    Extract unique category names from DoorDash order items.
    
    Args:
        doordash_data: Parsed JSON from doordash_orders.json
        clean_text_func: Optional function to clean category names (removes emojis, etc.)
    
    Returns:
        Set of cleaned category names
    """
    categories = set()
    orders = doordash_data.get('orders', [])
    
    for order in orders:
        order_items = order.get('order_items', [])
        for item in order_items:
            category = item.get('category', '')
            if category:
                if clean_text_func:
                    cleaned = clean_text_func(category)
                else:
                    cleaned = category.lower().strip()
                if cleaned:
                    categories.add(cleaned)
    
    return categories


def build_category_mapping_from_catalogs(
    square_categories: Optional[Set[str]] = None,
    toast_categories: Optional[Set[str]] = None,
    doordash_categories: Optional[Set[str]] = None,
    clean_text_func: Optional[Callable[[str], str]] = None
) -> Dict[str, str]:
    """
    Build comprehensive category mapping from catalog data.
    
    Merges base mappings with catalog-derived mappings using intelligent matching.
    
    Args:
        square_categories: Set of cleaned category names from Square catalog
        toast_categories: Set of cleaned itemGroup names from Toast data
        doordash_categories: Set of cleaned category names from DoorDash data
        clean_text_func: Optional function to clean text (for additional cleaning if needed)
    
    Returns:
        Dictionary mapping cleaned category names to standardized categories
    """
    # Start with base mappings
    mapping = BASE_CATEGORY_MAP.copy()
    
    # Combine all catalog categories
    all_categories = set()
    if square_categories:
        all_categories.update(square_categories)
    if toast_categories:
        all_categories.update(toast_categories)
    if doordash_categories:
        all_categories.update(doordash_categories)
    
    # Map catalog categories to standardized categories
    for category in all_categories:
        # Skip if already in mapping
        if category in mapping:
            continue
        
        # Try exact match first (should already be handled, but double-check)
        if category in BASE_CATEGORY_MAP:
            mapping[category] = BASE_CATEGORY_MAP[category]
            continue
        
        # Try partial/keyword matching
        matched = False
        for base_key, base_value in BASE_CATEGORY_MAP.items():
            # Check if base_key is in category (e.g., "steak" in "steaks")
            if base_key in category:
                mapping[category] = base_value
                matched = True
                break
            # Check if category is in base_key (e.g., "steaks" in "steak combo")
            if category in base_key:
                mapping[category] = base_value
                matched = True
                break
        
        # If no match found, try intelligent keyword matching
        if not matched:
            category_lower = category.lower()
            # Entree-related keywords
            if any(keyword in category_lower for keyword in ['steak', 'meat', 'entree', 'entres', 'chicken', 'beef', 'pork', 'lamb']):
                mapping[category] = ProductCategory.ENTREES.value
            # Beverage-related keywords
            elif any(keyword in category_lower for keyword in ['drink', 'beverage', 'coffee', 'juice', 'soda']):
                mapping[category] = ProductCategory.BEVERAGES.value
            # Alcohol-related keywords
            elif any(keyword in category_lower for keyword in ['beer', 'wine', 'cocktail', 'alcohol', 'spirit']):
                mapping[category] = ProductCategory.ALCOHOL.value
            # Sides/appetizers
            elif any(keyword in category_lower for keyword in ['side', 'appetizer', 'appitizer']):
                if 'appetizer' in category_lower or 'appitizer' in category_lower:
                    mapping[category] = ProductCategory.APPETIZERS.value
                else:
                    mapping[category] = ProductCategory.SIDES.value
    
    return mapping


def get_category_mapping(clean_text_func: Optional[Callable[[str], str]] = None) -> Dict[str, str]:
    """
    Get the comprehensive category mapping.
    
    Returns cached mapping if available, otherwise returns base mapping.
    The mapping should be initialized by calling build_category_mapping_from_catalogs() at startup.
    
    Args:
        clean_text_func: Optional function to clean text (not used if mapping is cached)
    
    Returns:
        Dictionary mapping cleaned category names to standardized categories
    """
    global _category_mapping_cache
    if _category_mapping_cache is not None:
        return _category_mapping_cache
    return BASE_CATEGORY_MAP.copy()


# ============================================
# NORMALIZATION FUNCTIONS (from base_model.py)
# ============================================

def normalize_category(category: str, clean_text_func: Optional[Callable[[str], str]] = None) -> str:
    """
    Normalize category to a standard value.
    Returns a value from ProductCategory enum.
    
    Uses comprehensive category mapping (base + catalog-derived).
    
    Args:
        category: Raw category string (may contain emojis, etc.)
        clean_text_func: Function to clean text (removes emojis, etc.) - should always be provided
    
    Returns:
        Standardized category string (ProductCategory enum value)
    """
    if not category:
        return ProductCategory.UNKNOWN.value
    
    # Get the comprehensive category mapping
    category_map = get_category_mapping(clean_text_func)
    
    # Clean text - clean_text_func should always be provided
    if clean_text_func:
        cleaned = clean_text_func(category)
    else:
        # Fallback: basic cleaning if clean_text_func not provided
        cleaned = category.lower().strip()
    
    # Direct lookup in comprehensive mapping
    if cleaned in category_map:
        return category_map[cleaned]
    
    # Partial match (e.g., "burger" in "burger combo")
    for key, value in category_map.items():
        if key in cleaned:
            return value
    
    # Default to unknown
    return ProductCategory.UNKNOWN.value


def get_location_name(location_id: str, source: str) -> str:
    """
    Get canonical location name from location ID.
    Falls back to pattern matching if not in LOCATION_MAPPING.
    """
    # Direct lookup
    if location_id in LOCATION_MAPPING:
        return LOCATION_MAPPING[location_id]
    
    # Pattern-based fallback
    location_lower = location_id.lower()
    if "downtown" in location_lower:
        return "Downtown"
    elif "airport" in location_lower:
        return "Airport"
    elif "mall" in location_lower:
        return "Mall Location"
    elif "univ" in location_lower or "university" in location_lower:
        return "University"
    
    # Default fallback
    return "Downtown"  # Or raise an error if preferred


# ============================================
# ORDER TYPE MAPPING FUNCTIONS (from base_model.py)
# ============================================

def map_doordash_order_type(fulfillment_method: str) -> str:
    """
    Map DoorDash fulfillment method to standard order type.
    MERCHANT_DELIVERY -> DELIVERY
    PICKUP -> PICKUP (keep separate, don't convert to TAKE_OUT)
    """
    if 'DELIVERY' in fulfillment_method.upper():
        return OrderType.DELIVERY.value
    else:  # PICKUP
        return OrderType.PICKUP.value


def map_square_order_type(fulfillment_type: str) -> str:
    """
    Map Square fulfillment type to standard order type.
    PICKUP -> PICKUP
    DELIVERY -> DELIVERY
    DINE_IN -> DINE_IN (default)
    """
    fulfillment_upper = fulfillment_type.upper()
    if fulfillment_upper == 'PICKUP':
        return OrderType.PICKUP.value
    elif 'DELIVERY' in fulfillment_upper:
        return OrderType.DELIVERY.value
    elif 'DINE' in fulfillment_upper or fulfillment_upper == 'DINE_IN':
        return OrderType.DINE_IN.value
    else:
        return OrderType.DINE_IN.value  # Default


def map_toast_order_type(dining_behavior: str) -> str:
    """
    Map Toast dining behavior to standard order type.
    DINE_IN -> DINE_IN
    TAKE_OUT -> TAKE_OUT
    DELIVERY -> DELIVERY
    """
    order_type_map = {
        'DINE_IN': OrderType.DINE_IN.value,
        'TAKE_OUT': OrderType.TAKE_OUT.value,
        'DELIVERY': OrderType.DELIVERY.value,
    }
    return order_type_map.get(dining_behavior, OrderType.DINE_IN.value)


# ============================================
# STATUS MAPPING FUNCTIONS (from base_model.py)
# ============================================

def map_doordash_status(order_status: str) -> str:
    """
    Map DoorDash order status to standard status.
    DELIVERED, PICKED_UP, COMPLETED, FULFILLED -> COMPLETED
    Others are kept as-is (CANCELLED, etc.)
    """
    if order_status in ('DELIVERED', 'PICKED_UP', 'COMPLETED', 'FULFILLED'):
        return OrderStatus.COMPLETED.value
    return order_status


def map_toast_status(voided: bool) -> str:
    """
    Map Toast voided flag to standard status.
    """
    return OrderStatus.VOIDED.value if voided else OrderStatus.COMPLETED.value


def map_square_status(state: str) -> str:
    """
    Map Square order state to standard status.
    """
    state_upper = state.upper() if state else ''
    if state_upper in ('COMPLETED', 'FULFILLED'):
        return OrderStatus.COMPLETED.value
    elif state_upper == 'CANCELLED':
        return OrderStatus.CANCELLED.value
    elif state_upper == 'REFUNDED':
        return OrderStatus.REFUNDED.value
    else:
        return OrderStatus.COMPLETED.value  # Default


# ============================================
# HELPER FUNCTIONS (from base_model.py)
# ============================================

def get_order_id_prefix(source_system: SourceSystem) -> str:
    """Get the prefix for order IDs based on source system."""
    prefix_map = {
        SourceSystem.TOAST: "TOAST",
        SourceSystem.DOORDASH: "DD",
        SourceSystem.SQUARE: "SQ",
    }
    return prefix_map.get(source_system, "UNK")


def format_order_id(source_system: SourceSystem, external_id: str) -> str:
    """Format order ID with source system prefix."""
    prefix = get_order_id_prefix(source_system)
    return f"{prefix}_{external_id}"

