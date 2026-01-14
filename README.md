# Clave Analytics Dashboard

A natural language dashboard for restaurant analytics that consolidates data from multiple POS systems and delivery platforms (Toast, DoorDash, Square) and provides AI-powered insights through an interactive web interface.

## Overview

This project consists of two main components:

- **Python Data Processing Scripts**: Process, clean, and normalize restaurant data from multiple sources into a unified PostgreSQL database schema
- **Next.js Analytics Dashboard**: A web application that uses natural language queries to generate dynamic visualizations and insights from the restaurant data

## Getting Started

### Prerequisites

- **Node.js** 18+ and npm
- **Python** 3.8+
- **PostgreSQL** database (Supabase recommended)
- **OpenAI API key** (for natural language query processing)

### 1. Python Data Processing Script

The Python script processes raw JSON data from multiple restaurant sources, normalizes it, and loads it into the database. It automatically creates the database schema if it doesn't exist.

**Install dependencies:**
```bash
pip install -r scripts/requirements.txt
```

**Configure database connection:**
```bash
# For Supabase (recommended)
export DATABASE_URL="postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres"


```

**Process and load data:**
```bash
cd scripts
python process_data.py
```

This script will:
- Parse data from Toast POS, DoorDash, and Square sources
- Clean and normalize product names, timestamps, and locations
- Create the database schema (tables, indexes, views)
- Load the processed data into PostgreSQL

For detailed instructions, see `scripts/README.md`.

### 2. Next.js Analytics Dashboard

The dashboard provides a natural language interface where users can type queries like "Show me sales comparison between Downtown and Airport locations" and get interactive visualizations.

**Install dependencies:**
```bash
cd analytics-dashboard
npm install
```

**Configure environment variables:**

Create a `.env.local` file in the `analytics-dashboard` directory:

```env
# OpenAI Configuration (required)
OPENAI_MYAPI_KEY=sk-your-openai-api-key-here


# Database Connection (required)
# Use the url for other user which only have read access to the db
DATABASE_URL=postgresql://postgres:[YOUR-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres


```

**Start the development server:**
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to access the dashboard.

The application will:
- Accept natural language queries about restaurant sales, products, locations, and time periods
- Use AI to generate appropriate SQL queries
- Execute queries against the database
- Generate dynamic visualizations (charts, tables, metrics)
- Display results as interactive widgets on the dashboard

For detailed setup and configuration, see `analytics-dashboard/SETUP.md`.

## Project Structure

- `scripts/` - Python scripts for data processing and database setup
- `analytics-dashboard/` - Next.js application with AI-powered query interface
- `data/sources/` - Raw JSON data files from Toast, DoorDash, and Square
- `docs/` - Additional documentation and examples

## Data Sources

The system processes data from three restaurant platforms:
- **Toast POS**: Order data with checks, payments, and menu items
- **DoorDash**: Delivery and pickup orders with items and fees
- **Square POS**: Catalog, orders, payments, and location data

All data is normalized into a unified schema covering orders, products, locations, and order items across 4 restaurant locations (Downtown, Airport, Mall, University) for the period January 1-4, 2025.
