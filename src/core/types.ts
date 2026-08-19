// Blockhouse core types — the shared vocabulary of the whole system.

export type Json = string | number | boolean | null | Json[] | { [k: string]: Json }

// ---------- content ----------

export interface BlockNode {
  id: string
  type: string
  props: Record<string, any>
  children?: BlockNode[]
}

export type DocStatus = 'draft' | 'review' | 'published'

export interface SeoData {
  title?: string
  description?: string
  keyword?: string          // focus keyword for editor checks
  canonical?: string
  noindex?: boolean
  image?: string            // media id for og:image
  ogType?: string
  jsonld?: Json[]           // extra hand-written structured data
}

export interface Doc {
  id: string
  concept: string
  slug: string
  title: string
  status: DocStatus
  fields: Record<string, any>
  blocks: BlockNode[]
  regions?: Record<string, BlockNode[]>
  seo?: SeoData
  template?: string          // per-doc template override
  author?: string
  publishAt?: string
  custom?: { css?: string; js?: string }   // per-page custom code
  aliases?: string[]         // extra paths that redirect (or mirror) to this doc
  mirror?: boolean           // true → aliases render the page instead of redirecting
  access?: DocAccess         // member gating
  createdAt: string
  updatedAt: string
  version: number
  slugHistory?: string[]     // previous slugs → automatic 301s
}

export interface DocAccess {
  /** 'public' (default) · 'members' (any signed-in member) · 'groups' */
  mode?: 'public' | 'members' | 'groups'
  groups?: string[]
  /** where to send unauthenticated visitors */
  redirect?: string
}

// ---------- fields (shared by concepts, blocks, plugin resources) ----------

export type FieldType =
  | 'text' | 'textarea' | 'richtext' | 'markdown' | 'code' | 'number' | 'boolean'
  | 'select' | 'date' | 'color' | 'image' | 'link' | 'json' | 'list' | 'svg' | 'table'

export interface FieldDef {
  key: string
  type: FieldType
  label?: string
  help?: string
  required?: boolean
  default?: any
  options?: { value: string; label?: string }[]   // for select
  item?: FieldDef[]                               // for list (repeatable group)
  min?: number
  max?: number
  rows?: number                                   // textarea height hint
  computed?: string                               // safe expression (data plugin)
  width?: 'half' | 'full'
}

// ---------- concepts (custom content types) ----------

export interface ConceptDef {
  name: string               // machine name, e.g. "post"
  label: string
  labelPlural?: string
  icon?: string
  urlPattern: string         // "/blog/{slug}" — {slug} required
  indexPath?: string         // "/blog" list page (optional)
  indexTemplate?: string
  template?: string          // defaults to concept name, falls back to "page"
  fields: FieldDef[]
  perPage?: number
  feed?: boolean             // emit RSS at `${indexPath}/feed.xml`
  seo?: {
    titlePattern?: string    // "{title} — {site}"
    schema?: 'article' | 'webpage' | 'none'
    /** The page template renders the H1 itself, so the SEO check should not
     *  look for one in the block tree. */
    templateH1?: boolean
  }
  hidden?: boolean           // not shown in studio nav
}

// ---------- menus ----------

export type MenuVisibility = 'all' | 'auth' | 'guest'

export interface MenuItem {
  id: string
  label: string
  type: 'link' | 'doc' | 'heading' | 'divider' | 'auto'
  href?: string
  docId?: string
  concept?: string           // for auto: latest N docs of concept
  limit?: number
  description?: string
  sublabel?: string          // e.g. "From £107,530" — showcase cards & rich links
  note?: string              // e.g. "Finance available"
  image?: string             // media id — showcase cards
  icon?: string
  visibility?: MenuVisibility
  roles?: string[]           // studio roles (rarely what you want on a public site)
  memberGroups?: string[]    // show only to signed-in members in one of these groups
  children?: MenuItem[]
  detail?: BlockNode[]       // custom detail-pane content (showcase mega)
  mega?: MegaPanel           // presence turns the item into a mega menu
}

export interface MegaPanel {
  /** columns = link lists · showcase = card rail + detail · catalogue = full-screen
   *  category tabs → item list → detail pane (the JLR pattern, with sub-panes). */
  layout?: 'columns' | 'showcase' | 'catalogue'
  columns?: MegaColumn[]            // columns layout
  items?: MenuItem[]                // showcase cards
  tabs?: MegaTab[]                  // catalogue categories
  ctaLabel?: string                 // catalogue detail button — default "Explore"
  tiles?: { icon?: string; label: string; href?: string; docId?: string }[]
  footer?: { label: string; href?: string; docId?: string }[]
  footerTitle?: string
  wide?: boolean
}
export interface MegaTab {
  id: string
  label: string
  items: MenuItem[]                 // list entries; sublabel = category line, description = detail copy
}
export interface MegaColumn {
  title?: string
  items?: MenuItem[]
  blocks?: BlockNode[]       // arbitrary block content inside the panel
  span?: number
}

export interface Menu { key: string; label?: string; items: MenuItem[] }

// ---------- site config ----------

export interface ImageConfig {
  provider?: 'local' | 'cloudflare'
  sizes: number[]
  formats: ('webp' | 'avif' | 'original')[]
  quality: number
  stripExif: boolean
  renamePattern: string      // "{slug}-{w}" tokens: slug, id, w, hash
  watermark?: { media?: string; file?: string; gravity?: string; opacity?: number; scale?: number; minWidth?: number } | null
}

export interface SiteConfig {
  name: string
  url: string                // canonical origin, e.g. https://example.com
  tagline?: string
  language?: string
  template: string
  seo: {
    titlePattern: string     // "{title} — {site}"
    description?: string
    image?: string
    twitter?: string
    robots?: string
    /**
     * Publisher identity. Everything past `name` is optional and only widens
     * the JSON-LD graph — supply an address and the site also publishes a
     * LocalBusiness node (set `localBusiness: false` to opt out, e.g. for an
     * online-only business with a registered office it does not trade from).
     */
    organization?: {
      name?: string
      legalName?: string
      logo?: string
      sameAs?: string[]
      telephone?: string
      email?: string
      address?: {
        streetAddress?: string
        addressLocality?: string
        addressRegion?: string
        postalCode?: string
        addressCountry?: string
      }
      localBusiness?: boolean
      businessType?: string        // a more specific schema.org type, e.g. "Store"
      priceRange?: string
      geo?: { latitude: number; longitude: number }
      openingHours?: any[]         // schema.org OpeningHoursSpecification entries
      areaServed?: any
      hasMap?: string
      aggregateRating?: { ratingValue: string | number; reviewCount: string | number; bestRating?: string | number; worstRating?: string | number }
    }
  }
  images: ImageConfig
  theme?: ThemeConfig
  fonts?: FontDef[]                             // custom @font-face fonts
  vars?: Record<string, any>                    // brand variables (values)
  varDefs?: VarDef[]                            // brand variable schema (editing UI)
  customCss?: string                            // site-wide custom CSS
  customJs?: string                             // site-wide custom JS (module)
  build?: BuildConfig
  urls?: UrlConfig
  modules?: ModuleConfig                        // studio UI module visibility
  slots?: Record<string, BlockNode[]>           // template slot injections
  mail?: { driver: string; from?: string; options?: Record<string, any> }
  plugins?: Record<string, { enabled: boolean; approved: string[]; settings?: Record<string, any> }>
  security?: SecurityConfig
  homeDocId?: string
  /** Documents standing in for built-in pages: '404', 'search', 'maintenance'. */
  systemPages?: Record<string, string>
  maintenance?: MaintenanceConfig
  /** Core site behaviours you can switch off without touching code. */
  features?: FeaturesConfig
}

export interface FeaturesConfig {
  viewTransitions?: boolean   // cross-document view transitions (default on)
  prefetch?: boolean          // speculation rules + hover prefetch (default on)
  themeToggle?: boolean       // mirror of theme.showToggle, exposed with the rest
  rss?: boolean               // concept feeds + head links (default on)
  sitemap?: boolean           // sitemap.xml (default on)
  analyticsBeacon?: boolean   // send the analytics hit (default on when plugin enabled)
  searchOpenSearch?: boolean  // opensearch.xml + head link (default on when search enabled)
}

export interface MaintenanceConfig {
  enabled?: boolean
  /** Message shown when no maintenance document is chosen. */
  message?: string
  /** Paths that stay reachable while maintenance is on (studio is always open). */
  allow?: string[]
  /** Retry-After hint in seconds. */
  retryAfter?: number
}

export interface ThemeConfig {
  tokens?: Record<string, string>
  /** 'auto' follows the OS; 'light'/'dark' locks the public site to one scheme. */
  colorScheme?: 'auto' | 'light' | 'dark'
  /** show the theme toggle in templates that offer one (ignored when locked) */
  showToggle?: boolean
}

export interface VarDef {
  key: string
  label: string
  type: 'text' | 'textarea' | 'color' | 'image' | 'link' | 'number' | 'boolean' | 'select'
  help?: string
  group?: string
  options?: { value: string; label?: string }[]
  default?: any
}

export interface UrlConfig {
  /** 'directory' → /about/  · 'extension' → /about.html · 'bare' → /about */
  style?: 'directory' | 'extension' | 'bare'
  /** where concept docs land: 'pattern' uses the concept urlPattern, 'flat' puts everything at root */
  layout?: 'pattern' | 'flat'
  lowercase?: boolean
  /** enable /s/<code> shortlinks for published docs */
  shortlinks?: boolean
  shortlinkPrefix?: string
}

export interface ModuleConfig {
  /** hide studio modules entirely (per install), e.g. { menus: false } */
  hidden?: string[]
  /** hide modules for specific roles: { author: ['seo','settings'] } */
  hiddenForRole?: Record<string, string[]>
}

export interface SecurityConfig {
  pbkdf2Iterations?: number
  /** Content-Security-Policy on public pages */
  csp?: 'off' | 'balanced' | 'strict'
  cspExtra?: Record<string, string>       // { 'img-src': "'self' data: https://cdn.x" }
  hsts?: boolean
  frameAncestors?: string                 // default "'none'"
  referrerPolicy?: string
  permissionsPolicy?: string
  /** failed logins before a temporary lockout */
  maxLoginAttempts?: number
  lockoutMinutes?: number
  /** restrict /admin to these CIDRs/IPs (empty = anywhere) */
  adminAllowlist?: string[]
  auditLog?: boolean
  minPasswordLength?: number
}

export interface FontDef {
  family: string
  file: string               // media/... path
  weight?: number | string
  style?: 'normal' | 'italic'
  format?: 'woff2' | 'woff' | 'truetype'
  preload?: boolean
  role?: 'body' | 'display' | 'mono'   // assign to a token
}

export interface BuildConfig {
  cleanUrls?: boolean        // /about/ vs /about/index.html hints (export)
  trailingSlash?: boolean
  minify?: boolean           // collapse whitespace in exported HTML
  basePath?: string          // deploy under a sub-path
  generateSearchIndex?: boolean
  /** Per-page weight ceilings in bytes — `blockhouse budget` fails when a page exceeds one. */
  budget?: {
    html?: number
    css?: number
    js?: number
    total?: number
    images?: number
    requests?: number
  }
}

export interface Redirect { from: string; to: string; code?: number }

// ---------- users / auth ----------

export type Role = 'owner' | 'admin' | 'editor' | 'author' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  role: Role
  grants?: string[]          // extra fine-grained permissions
  active: boolean
  createdAt: string
}

export interface Session { id: string; userId: string; expiresAt: number; ua?: string }

// ---------- blocks (definitions live in the registry) ----------

export interface RenderCollect {
  jsonld: Json[]
  variants: Set<string>      // image derivative URLs referenced (export pre-generates)
  enhancers: Set<string>     // runtime JS modules needed by blocks on the page
  headExtra: string[]
}

export interface RenderCtx {
  site: SiteConfig
  doc?: Doc
  mode: 'live' | 'preview' | 'export'
  annotate: boolean          // add data-wb attributes for the editor
  user?: User | null
  member?: { id: string; groups?: string[] } | null   // signed-in site visitor
  collect: RenderCollect
  path: string
  canonicalPath?: string     // set when serving a mirrored alias — canonical points here
  menuDraft?: string         // menu key rendered from the studio's draft buffer
  bare?: boolean             // hide site chrome (editor focused mode)
  baseUrl: string            // '' live, absolute for export? kept '' — canonical handled in seo
  env: any                   // BlockhouseEnv (typed loosely to avoid cycles)
}

export interface BlockDef {
  type: string
  label: string
  group: string
  icon?: string
  description?: string
  fields: FieldDef[]
  defaults?: Record<string, any>
  container?: boolean
  childTypes?: string[]      // restrict children (e.g. faq → faq-item)
  hiddenFromPicker?: boolean
  enhance?: string           // runtime enhancer key
  render: (ctx: RenderCtx, node: BlockNode, inner: string) => string | Promise<string>
  jsonld?: (ctx: RenderCtx, node: BlockNode) => Json | null
  permission?: string        // required to insert (e.g. raw html)
  /** This block renders the page's H1 — used by the SEO checks. */
  providesH1?: boolean
}

// ---------- plugins ----------

export interface PluginManifest {
  id: string
  name: string
  version: string
  description?: string
  permissions: string[]
  builtin?: boolean
}

export interface ResourceDef {
  key: string                // API path segment
  label: string
  labelSingular?: string
  icon?: string
  fields: FieldDef[]
  titleField?: string
  storage: 'json' | 'secure' // json → site/<plugin>/<key>/*.json, secure → sql rows
  readPerm?: string
  writePerm?: string
}

export interface MailMessage { to: string; subject: string; text?: string; html?: string; from?: string }
export interface MailDriver { id: string; send: (msg: MailMessage, options: Record<string, any>) => Promise<void> }

export interface AutomationAction {
  type: string
  label: string
  /** Option form definition for the recipe builder (optional). */
  fields?: { key: string; label: string; type?: string; help?: string; required?: boolean; options?: any[] }[]
  run: (options: Record<string, any>, payload: Record<string, any>, ctx: any) => Promise<any>
}

// ---------- events ----------

export type EventHandler = (payload: Record<string, any>, event: string) => void | Promise<void>

// ---------- media ----------

export interface MediaMeta {
  id: string
  file: string               // key under media/
  name: string
  alt?: string
  title?: string
  caption?: string
  credit?: string
  folder?: string            // virtual folder path, e.g. "brand/logos"
  tags?: string[]
  width?: number
  height?: number
  type: string
  size: number
  dominant?: string
  /** focal point 0–1 used for object-position on crops */
  focal?: { x: number; y: number }
  noWatermark?: boolean
  private?: boolean
  createdAt: string
  updatedAt?: string
}
