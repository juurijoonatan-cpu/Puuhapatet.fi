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

### ADMIN SITE - PHASE A COMPLETE, PHASE B IN PROGRESS
This is the core product. iPad-first tool for field operations.

**Phase A Complete:**
- Auth gate with password (client-side UI gate)
- Profile system with roles (HOST/BOARD_MEMBER/STAFF)
- Profile completion gate (first user = HOST)
- Invite code system for adding new users
- Admin nav with liquid glass style (Dashboard, Uusi, Kalenteri, Keikat, Asetukset)
- Dashboard with greeting and metric cards
- Settings with profile management, theme toggle, user management, API diagnostics

**Phase B In Progress:**
- "Uusi Keikka" wizard skeleton implemented (6 steps)
- Calendar placeholder with week/day views

**Remaining:**
- Complete New Job wizard (package selection, agreement/signatures, completion)
- Calendar event creation and job linking
- Jobs list with API integration (awaiting list_jobs endpoint)
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
│       ├── profile-setup.tsx  # Profile completion flow
│       ├── dashboard.tsx
│       ├── new-job.tsx        # Uusi Keikka wizard
│       ├── calendar.tsx       # Scheduling calendar
│       ├── jobs.tsx
│       ├── packages.tsx
│       └── settings.tsx
├── lib/
│   ├── i18n.tsx      # Bilingual translations
│   ├── api.ts        # Google Apps Script adapter
│   ├── admin-profile.ts  # Profile/roles/invites system
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
- 2024-12-31: **Phase A Admin** - Profile system, roles, invite codes, profile completion gate
- 2024-12-31: **Phase A Admin** - Updated admin nav (Dashboard, Uusi, Kalenteri, Keikat, Asetukset)
- 2024-12-31: **Phase A Admin** - Settings with profile, theme, users/invites, API diagnostics
- 2024-12-31: **Phase B Admin** - New Job wizard skeleton (6 steps: prefill, customer, assessment, package, agreement, completion)
- 2024-12-31: **Phase B Admin** - Calendar placeholder with week/day toggle

## Next Steps (Admin Focus)
1. Complete Uusi Keikka wizard - package selection UI, agreement/signature step, job completion
2. Calendar integration - event creation, link to jobs
3. Jobs page - await list_jobs API, implement local caching
4. Invoice link generation
