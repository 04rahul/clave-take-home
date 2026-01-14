This is a [Next.js](https://nextjs.org) project for an AI-powered analytics dashboard.

## Getting Started

First, install the dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

Then, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Project Structure

- **`app/`** - Next.js app directory containing pages and API routes
  - `page.tsx` - Main dashboard page
  - `admin-dashboard/` - Admin interface for viewing interaction logs
  - `api/generate-chart/` - API endpoint for processing natural language queries and generating charts
  - `api/admin/logs/` - API endpoint for fetching interaction logs
  - `layout.tsx` - Root layout with theme provider
  - `globals.css` - Global styles

- **`components/`** - React components
  - `chat-view.tsx` - Natural language query input interface
  - `dashboard-view.tsx` - Main dashboard with chart widgets
  - `chart-display.tsx` - Chart visualization component
  - `theme-provider.tsx` - Dark/light theme provider
  - `ui/` - Reusable UI components (buttons, cards, dialogs, etc.)

- **`lib/`** - Core business logic and utilities
  - `services/` - AI services (SQL generation, data analysis)
    - `sql-generator.ts` - Generates SQL queries from natural language
    - `data-analyzer.ts` - Analyzes query results and generates insights
  - `guardrails/` - Validation and security layers
    - `llm-content-filter.ts` - Validates queries are restaurant-related
    - `sql-validator.ts` - Validates SQL queries for safety
    - `result-validator.ts` - Validates query results
    - `insight-validator.ts` - Validates generated insights
  - `utils/` - Utility functions
    - `execute-sql.ts` - Executes SQL queries against PostgreSQL
    - `transform-results.ts` - Transforms query results for charts
    - `format-data-for-analysis.ts` - Formats data for AI analysis
    - `log-interaction.ts` - Logs user interactions to database
  - `supabase/` - Supabase client configuration
  - `types.ts` - TypeScript type definitions
  - `errors.ts` - Error handling utilities

- **`prompts/`** - LLM prompt templates
  - `sql-generation.json` - Prompt for SQL query generation
  - `data-analysis.json` - Prompt for data analysis and insights
  - `content-filter.txt` - Prompt for content filtering

- **`public/`** - Static assets (icons, images)

- **`hooks/`** - Custom React hooks

- **`scripts/`** - Utility scripts for testing




