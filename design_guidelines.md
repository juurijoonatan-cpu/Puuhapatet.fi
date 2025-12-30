# Puuhapatet Laskutus - Design Guidelines

## Design Philosophy
World-class minimalist UI inspired by Apple's calm aesthetic. Premium, breathable, precise. Think "liquid glass" meets Nordic minimalism with forest-inspired accents.

## Visual References
The attached images define the UI feel:
- **Primary inspiration**: Liquid glass pill navigation (mobile bottom nav)
- **Copy from references**: Rounded cards, soft shadows, airy spacing, clean typography, light premium feel, subtle micro-motions
- **DO NOT copy**: Specific colors, brand elements, or content - adapt everything to Puuhapatet brand

## Color Palette

**Primary (Forest Green)**
- Main: `#4A5D4F`
- Light: `#6B7F6E`  
- Dark: `#3A4D3F`

**Neutrals**
- Background: `#FAFBFA` (ultra-light warm gray)
- Surface: `#FFFFFF`
- Text Primary: `#1A1F1E`
- Text Secondary: `#6B7570`
- Text Tertiary: `#9BA19E`
- Border: `#E5E7E6`

**Status Colors**
- Success: `#4CAF50`
- Warning: `#FF9800`
- Error: `#F44336`
- Info: `#2196F3`

**Glass Morphism**
- Background: `rgba(255, 255, 255, 0.7)` with `backdrop-blur-xl`
- Border: `rgba(74, 93, 79, 0.1)`
- Shadow: `0 8px 32px rgba(0,0,0,0.08)`

## Typography (Poppins)

**Scale**
- Display: 48px / 600 / 1.2
- H1: 32px / 600 / 1.3
- H2: 24px / 600 / 1.4
- H3: 20px / 500 / 1.5
- Body Large: 18px / 400 / 1.6
- Body: 16px / 400 / 1.6
- Body Small: 14px / 400 / 1.5
- Caption: 12px / 400 / 1.5

**Usage**: Use generous line-heights (1.6-1.8 for body text). Create hierarchy through size and weight contrast (400/500/600 only).

## Spacing System (8px Base Grid)
- xs: 4px
- sm: 8px  
- md: 16px
- lg: 24px
- xl: 32px
- 2xl: 48px
- 3xl: 64px

Use consistently throughout. Cards get `24-32px` padding. Section spacing: `48-64px`.

## Border Radius
- Small elements: 8px
- Cards: 16px
- Buttons: 12px
- Pill nav: 20px (xl)
- Full: 9999px (for badges/pills)

## Shadows (Layered & Soft)
- sm: `0 1px 2px rgba(0,0,0,0.04)` - subtle elevation
- md: `0 2px 8px rgba(0,0,0,0.08)` - cards at rest
- lg: `0 4px 16px rgba(0,0,0,0.12)` - cards on hover
- glass: `0 8px 32px rgba(0,0,0,0.08)` - liquid glass nav

## Signature Component: Liquid Glass Navigation

**Mobile (Bottom Nav)**
- Position: Fixed bottom, centered horizontally
- Style: Pill-shaped container with 4-5 icon-only tabs
- Effect: `backdrop-blur-xl` + `bg-white/70` + soft border `border-forest-green/10`
- Shadow: Glass shadow (8px 32px)
- Radius: 20px (xl)
- Padding: 12px horizontal, 8px vertical
- Icons: 24px, forest green when active, gray when inactive
- Active state: Subtle scale (1.05) + color change, no background
- Spacing: Even distribution with 16px gaps

**Desktop**
- Top horizontal nav OR left sidebar (context-dependent)
- Same glass effect, adjusted layout
- Maintain visual consistency with mobile

## Card System

**Premium Cards**
- Background: White
- Border radius: 16px
- Padding: 24-32px
- Shadow: md at rest, lg on hover
- Transition: `200ms ease` for hover lift
- Hover: Translate up 2px + shadow upgrade
- Border: Optional 1px border in `#E5E7E6` for subtle definition

## Buttons

**Primary (Forest Green)**
- Background: `#4A5D4F`
- Text: White
- Radius: 12px
- Padding: 12px 24px
- Hover: Darken to `#3A4D3F` + subtle lift
- Active: Scale 0.98

**Secondary**
- Border: 1px forest green
- Text: Forest green
- Background: Transparent
- Hover: Light green background `#F0F4F1`

**Ghost**
- No border, no background
- Text: Forest green
- Hover: Light background

**On Images/Hero**: Add `backdrop-blur-md` + `bg-white/10` + white text for buttons over images. No special hover interactions beyond standard button states.

## Form Elements

**Inputs**
- Border: 1px `#E5E7E6`
- Radius: 8px
- Padding: 12px 16px
- Focus: Forest green border + subtle shadow
- Error: Red border + error icon + helper text below
- Success: Green checkmark icon

**Validation**
- Real-time inline feedback
- Icons (Lucide) for states
- Smooth 200ms transitions

## Loading States
- Skeleton loaders matching exact content dimensions
- Subtle pulse animation (CSS only)
- Color: `#F0F2F1`
- Match card structure precisely

## Empty States
- Lucide icon (48px, muted color)
- Heading (H3): Clear, friendly message
- Description (Body): Helpful context
- CTA button: Clear action
- Vertical spacing: lg between elements
- No custom illustrations

## Status Badges
- Rounded pill shape (full radius)
- Small text (12px / 600)
- Colors:
  - DRAFT: Gray
  - NEW: Blue
  - SCHEDULED: Orange
  - IN_PROGRESS: Purple
  - DONE: Green
  - CANCELLED: Red
- Padding: 4px 12px

## Animations (Minimal CSS Only)
- Transitions: 200-300ms ease
- Hover effects: Subtle lift (2-4px) + shadow change
- Page transitions: Simple fade (200ms)
- NO heavy libraries, NO Lottie
- Micro-interactions: Scale on press (0.98), color fade

## Images

**Landing Hero**
- Large hero image showcasing landscaping/garden work
- Height: 60-80vh on desktop, 50vh mobile
- Treatment: Subtle overlay (dark gradient 0.2 opacity) for text readability
- Buttons: Implement with backdrop-blur background

**Service Cards**
- Optional package preview images (if available)
- Rounded corners matching card radius
- Aspect ratio: 16:9 or 4:3

## Multi-Step Form Design
- Progress indicator: Pill-shaped steps at top
- Active step: Forest green, completed: checkmark, future: gray outline
- Card-based step content
- Primary button: "Jatka" (Continue) / "Lähetä" (Submit)
- Secondary: "Takaisin" (Back)
- Smooth height transitions between steps

## Responsive Strategy
- Mobile-first: 375px base
- Breakpoints: sm (640px), md (768px), lg (1024px), xl (1280px)
- Touch targets: Minimum 44px height
- Bottom nav: 16px from bottom edge on mobile
- Desktop: More generous spacing (multiply mobile by 1.5x)

## Accessibility
- Focus visible states: 2px forest green outline
- Color contrast: Minimum 4.5:1
- Semantic HTML
- ARIA labels on icon-only buttons
- Error messages linked to form fields

## Key Principles
1. **Breathable**: Generous whitespace everywhere
2. **Symmetric**: Centered layouts, balanced compositions  
3. **Data-clear**: Information hierarchy always obvious
4. **Premium feel**: Quality over quantity in every detail
5. **Subtle motion**: Transitions smooth but never distracting