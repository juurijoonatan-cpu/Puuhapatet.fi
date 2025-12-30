# Puuhapatet Laskutus

Premium PWA for job booking and management with world-class minimalist UI.

## Overview

Puuhapatet Laskutus is a modern web application for booking landscaping and garden services. It features:

- **Customer booking flow** - Multi-step form for service requests
- **Admin dashboard** - Job management and service catalog
- **Liquid glass UI** - Premium minimalist design with glass morphism
- **PWA support** - Installable app with offline UI caching

## Tech Stack

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: TailwindCSS + shadcn/ui
- **Data**: TanStack Query + Zod validation
- **Backend**: Express.js + Google Apps Script API
- **PWA**: Manifest + Service Worker ready

## Getting Started

```bash
npm install
npm run dev
```

## Environment Variables

### Required

| Variable | Description | Example |
|----------|-------------|---------|
| `VITE_ADMIN_PASSWORD` | Admin panel password (client-side only) | `your-password` |

## Security Notice

⚠️ **IMPORTANT**: The admin authentication is a **client-side UI gate only**, NOT a security boundary.

The password stored in `VITE_ADMIN_PASSWORD` is bundled into the client JavaScript and can be viewed in browser dev tools. This is intentional for MVP - it prevents accidental access, not malicious access.

For production security:
1. Implement proper server-side authentication
2. Use Replit Auth or OAuth providers
3. Add API-level access control

## API Integration

The app integrates with a Google Apps Script backend. All POST requests use `text/plain` Content-Type with JSON string body.

### Endpoints

- `GET ?action=health` - Health check
- `GET ?action=packages` - Get service packages
- `POST ?action=upsert_job` - Create/update job
- `POST ?action=get_job` - Get job by ID
- `GET ?action=list_jobs` - List jobs (Phase 3)

### JobID Generation

JobIDs are **client-generated** using the format: `PP-{timestamp}-{random}`

Example: `PP-M1XYZ123-AB12`

## Project Structure

```
client/
├── src/
│   ├── components/     # Reusable UI components
│   ├── pages/          # Route pages
│   │   └── admin/      # Admin panel pages
│   ├── lib/            # Utilities and API client
│   └── hooks/          # Custom React hooks
server/
├── routes.ts           # API routes (minimal)
└── storage.ts          # Storage interface
shared/
└── schema.ts           # Data models and validation
```

## Phases

### Phase 1 (Current) - MVP Foundation
- ✅ Public booking flow
- ✅ Liquid glass navigation
- ✅ Multi-step form
- ✅ Confirmation with JobID
- ✅ Basic admin panel
- ✅ PWA manifest

### Phase 2 - Admin Core
- Admin job lookup by ID
- Job status updates
- Packages catalog
- API diagnostics

### Phase 3 - Full Jobs List
- `list_jobs` endpoint integration
- Filtering and search
- Dashboard stats

## Design System

See `design_guidelines.md` for the complete visual design specification.

### Key Colors
- **Primary**: #4A5D4F (Forest Green)
- **Background**: #FAFBFA (Ultra-light)
- **Surface**: #FFFFFF

### Typography
- **Font**: Poppins (400, 500, 600, 700)
- **Scale**: 12px - 48px

## License

Proprietary - Puuhapatet
