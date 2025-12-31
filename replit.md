# Puuhapatet - Project Documentation

## Overview
Premium PWA-style web app for Puuhapatet window cleaning and glass surface maintenance service in Espoo, Finland. The project consists of two main parts:
1. **Customer Site** (PUBLIC) - Marketing/lead generation
2. **Admin Ops** (INTERNAL) - iPad-first tool for door-to-door sales + job operations

## Project State

### CUSTOMER SITE - COMPLETED & LOCKED
The customer-facing site is complete and should NOT be modified unless explicitly required for:
- Field mapping alignment with Admin
- Critical branding fixes

Customer site features completed:
- Landing page with typewriter effect hero
- Services page (Palvelut)
- FAQ page with accordion
- About page (Meistä)
- Contact/booking form (Tilaus) - simple lead form, NOT package-first
- Confirmation page with Puuha-ID display
- Customer reviews section with animated counters (96% recommend, 4.8/5 Google rating)
- Leave review form (4-step: rating → service → comment → name/area)
- Bilingual FI/EN support with language toggle
- Liquid glass navigation (bottom nav on mobile, top header on desktop)
- Mobile header with Puuhapatet branding
- Responsive design

### ADMIN SITE - IN PROGRESS (PRIORITY)
This is the core product. iPad-first tool for field operations.

Admin features needed:
- Auth gate (env password, client-side only - NOT real security)
- Profile completion gate (name, role, photo required)
- Dashboard with key metrics
- "Uusi Keikka" wizard (New Job - the heart of admin)
- Calendar (simple scheduling)
- Jobs list/search (Keikat)
- Settings with API diagnostics
- User management (Host can invite, assign roles)
- Invoice link generation

## Architecture

### Stack
- Vite + React + TypeScript
- Tailwind CSS + shadcn/ui (Radix)
- Wouter for routing
- TanStack Query for data fetching

### Backend
- Google Apps Script + Sheets (external)
- API endpoints via Apps Script Web App:
  - GET ?action=health
  - GET ?action=packages
  - POST ?action=upsert_job (Content-Type: text/plain)
  - POST ?action=get_job
  - (list_jobs coming later)

### Security Note
Admin auth is a lightweight client-side gate only. The VITE_ADMIN_PASSWORD is bundled in the client - this is a UI gate, NOT a security boundary. Code is ready for future real auth but not implemented now.

## Key Design Decisions
- "Liquid glass" nav is the core UI identity - must remain
- Enterprise-simple: clarity > wow effects
- Minimal but premium design
- Customer pages: slightly more marketing feel
- Admin pages: tool/ops feel
- Finnish default, English available

## File Structure
```
client/src/
├── components/
│   ├── ui/           # shadcn components
│   ├── liquid-glass-nav.tsx
│   ├── typewriter.tsx
│   ├── animated-counter.tsx
│   ├── reviews-section.tsx
│   └── protected-route.tsx
├── pages/
│   ├── landing.tsx
│   ├── services.tsx
│   ├── faq.tsx
│   ├── about.tsx
│   ├── booking.tsx
│   ├── confirmation.tsx
│   └── admin/
│       ├── login.tsx
│       ├── dashboard.tsx
│       ├── jobs.tsx
│       ├── packages.tsx
│       └── settings.tsx
├── lib/
│   ├── i18n.tsx      # Bilingual translations
│   ├── api.ts        # Google Apps Script adapter
│   ├── theme.tsx
│   └── queryClient.ts
└── App.tsx
```

## Environment Variables
- `VITE_ADMIN_PASSWORD` - Client-side admin gate password (NOT secure)
- `SESSION_SECRET` - Express session secret

## User Preferences
- Focus on Admin functionality first
- Do not modify customer site unless necessary
- Keep UI minimal and consistent with liquid glass style
- Choose simplest enterprise solution when unclear
- Document assumptions in comments

## Recent Changes
- 2024-12-31: Customer site completed and locked
- 2024-12-31: Added customer reviews section with animated counters
- 2024-12-31: Added 4-step review form (rating, service, comment, name/area)
- 2024-12-31: Added mobile header with Puuhapatet branding
- 2024-12-31: Bilingual FI/EN system implemented

## Next Steps (Admin Focus)
1. Implement auth gate with profile completion flow
2. Build Dashboard with key metrics
3. Create "Uusi Keikka" wizard (5 steps)
4. Add Calendar functionality
5. Add Jobs search/list
6. Settings with API diagnostics
