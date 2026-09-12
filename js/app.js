import { applyTranslations, detectLanguage, translations } from "./i18n.js";
import { getSupabaseClient, getSupabasePublicUrl } from "./supabaseClient.js";
import {
  books as fallbackBooks,
  discounts as fallbackDiscounts,
  events as fallbackEvents,
  galleryItems as fallbackGalleryItems,
  posts as fallbackPosts
} from "./data/content.js";

const state = {
  language: detectLanguage(),
  dictionary: translations.fr,
  content: {
    books: fallbackBooks,
    discounts: fallbackDiscounts,
    events: fallbackEvents,
    galleryItems: fallbackGalleryItems,
    posts: fallbackPosts
  },
  adminCatalogBooks: [],
  catalogPage: 1,
  adminCatalogPage: 1,
  auth: {
    session: null,
    profile: null,
    user: null
  }
};

const protectedRoutes = {
  adherent: "adherent",
  admin: "admin"
};

const publicCatalogLimit = 20;
const publicCatalogRotationMs = 4 * 60 * 60 * 1000;
const catalogPageSize = 50;

function fromRoot(path = "") {
  const root = document.body.dataset.root || ".";
  return `${root}/${path}`.replace(/\/{2,}/g, "/").replace("././", "./");
}

function route(path = "") {
  return fromRoot(path);
}

function resolveAssetPath(path) {
  if (!path) return "";
  if (/^(https?:|data:|blob:|\/)/.test(path)) return path;
  if (path.startsWith("./")) return fromRoot(path.slice(2));
  return path;
}

function getStorageUrl(bucket, path, fallback = "./assets/edgard-petit.jpg") {
  return getSupabasePublicUrl(bucket, path) || resolveAssetPath(fallback);
}

function getProfileRole(profile) {
  return profile?.roles_permissions?.role_name || profile?.role_name || "";
}

function isStaffProfile(profile) {
  const roleName = getProfileRole(profile);
  return ["SuperAdmin", "Administrateur", "Bibliothécaire", "Modérateur", "Comptable"].includes(roleName);
}

function canEditCatalogBooks() {
  return document.body.dataset.page === "admin" &&
    document.body.dataset.adminModule === "catalogue" &&
    isStaffProfile(state.auth.profile);
}

function normalizeAuthUser(session, profile) {
  if (!session?.user) return null;

  const isAdmin = isStaffProfile(profile);
  return {
    role: isAdmin ? "admin" : "adherent",
    name: profile?.full_name || session.user.email?.split("@")[0] || "Utilisateur",
    email: session.user.email || profile?.email || "",
    status: profile?.status || "pending",
    roleName: getProfileRole(profile),
    createdAt: session.user.created_at
  };
}

async function loadAuthState() {
  const client = await getSupabaseClient();
  if (!client) return null;

  const { data: sessionData } = await client.auth.getSession();
  const session = sessionData?.session || null;
  state.auth.session = session;
  state.auth.profile = null;
  state.auth.user = null;

  if (!session?.user) return null;

  const { data: profile, error } = await client.rpc("get_my_session_profile").maybeSingle();

  if (error) {
    console.warn("Profil connecté illisible.", error);
  }

  state.auth.profile = profile || null;
  state.auth.user = normalizeAuthUser(session, profile);
  return state.auth.user;
}

function mapBook(row) {
  const details = row.book_details || {};
  return {
    id: row.id,
    number: row.number || "",
    location: row.location || "",
    detailId: row.detail_id || details.id || "",
    category: details.category || row.category || "Catalogue",
    title: details.title || row.title || "Ouvrage sans titre",
    author: details.author || row.author || "Auteur non renseigné",
    edition: details.edition || row.edition || "",
    language: details.language || row.language || "",
    ownership: row.ownership || "",
    summary: details.summary || row.summary || "",
    description: details.description || row.description || ""
  };
}

function mapEvent(row) {
  return {
    id: row.id,
    type: row.event_type || row.type || "Conférence",
    title: row.title || "Événement",
    description: row.description || "",
    date: row.event_date || row.date,
    location: row.location || "Bibliothèque Edgard Petit",
    capacity: row.capacity || 1,
    registered: row.registered || 0,
    basePrice: Number(row.base_price || row.basePrice || 0),
    status: row.status || "draft",
    visibility: row.visibility || "public",
    paymentRequired: Boolean(row.payment_required || row.paymentRequired),
    flyer: getStorageUrl("event-flyers", row.flyer_path || row.flyer, "./assets/events/suretes-reelles-droit-haitien.png"),
    flyerAlt: row.flyer_alt || row.flyerAlt || row.title || "Flyer de l'événement"
  };
}

function mapBlogPhoto(row) {
  return {
    id: row.id,
    title: row.title || "Photo",
    src: getStorageUrl("blog-gallery", row.storage_path || row.src),
    alt: row.alt_text || row.alt || row.title || "Photo liée à la publication"
  };
}

function mapPost(row) {
  return {
    id: row.slug || row.id,
    databaseId: row.id,
    title: row.title || "Publication",
    excerpt: row.excerpt || "",
    content: row.content || "",
    category: row.category || "Éducation",
    authorName: row.author_name || row.authorName || "",
    auditorName: row.auditor_name || row.auditorName || "",
    publishedAt: row.published_at || row.publishedAt || row.created_at || new Date().toISOString(),
    cover: getStorageUrl("blog-covers", row.cover_path || row.cover),
    coverAlt: row.cover_alt || row.coverAlt || row.title || "Image de couverture",
    status: row.status || "draft",
    gallery: (row.blog_post_photos || row.gallery || []).map(mapBlogPhoto)
  };
}

function mapGalleryItem(row) {
  return {
    id: row.id,
    title: row.title || "Photo",
    description: row.description || "",
    album: row.album || "Vie de la bibliothèque",
    src: getStorageUrl("gallery-photos", row.storage_path || row.src),
    alt: row.alt_text || row.alt || row.title || "Photo de la bibliothèque",
    status: row.status || "draft",
    publishedAt: row.created_at || row.publishedAt || new Date().toISOString()
  };
}

async function loadSupabaseContent() {
  const client = await getSupabaseClient();
  if (!client) return;

  try {
    const bookSource = hasPrivateAccess() ? "books" : "public_book_showcase";
    const [
      booksResponse,
      discountsResponse,
      eventsResponse,
      postsResponse,
      galleryResponse
    ] = await Promise.all([
      client.from(bookSource).select("*"),
      client.from("event_discounts").select("*"),
      client.from("events").select("*").eq("status", "published").order("event_date", { ascending: true }),
      client
        .from("blog_posts")
        .select("*, blog_post_photos(*)")
        .eq("status", "published")
        .order("published_at", { ascending: false }),
      client.from("gallery_photos").select("*").eq("status", "published").order("sort_order", { ascending: true })
    ]);

    if (!booksResponse.error && booksResponse.data?.length) {
      state.content.books = booksResponse.data.map(mapBook);
    }

    if (!discountsResponse.error && discountsResponse.data?.length) {
      state.content.discounts = discountsResponse.data.map((row) => ({
        prefix: row.member_type_prefix,
        percentage: Number(row.discount_percentage || 0)
      }));
    }

    if (!eventsResponse.error && eventsResponse.data?.length) {
      state.content.events = eventsResponse.data.map(mapEvent);
    }

    if (!postsResponse.error && postsResponse.data?.length) {
      state.content.posts = postsResponse.data.map(mapPost);
    }

    if (!galleryResponse.error && galleryResponse.data?.length) {
      state.content.galleryItems = galleryResponse.data.map(mapGalleryItem);
    }
  } catch (error) {
    console.warn("Chargement Supabase indisponible, données locales utilisées.", error);
  }
}

function getCurrentUser() {
  return state.auth.user;
}

async function clearCurrentUser() {
  const client = await getSupabaseClient();
  await client?.auth.signOut();
  state.auth.session = null;
  state.auth.profile = null;
  state.auth.user = null;
}

function getRequestedDestination(defaultRole = "adherent") {
  const params = new URLSearchParams(window.location.search);
  const next = params.get("next");
  return next === "admin" || next === "adherent" ? next : defaultRole;
}

function showAuthMessage(messageElement, text, type = "success") {
  if (!messageElement) return;
  messageElement.textContent = text;
  messageElement.classList.toggle("is-error", type === "error");
  messageElement.classList.remove("hidden");
}

function getAuthErrorMessage(error) {
  const rawMessage = `${error?.message || ""}`.toLowerCase();
  const rawCode = `${error?.code || ""}`.toLowerCase();

  if (rawMessage.includes("email not confirmed") || rawCode.includes("email_not_confirmed")) {
    return "Votre email n'est pas encore confirmé dans Supabase.";
  }

  if (rawMessage.includes("invalid login credentials") || rawCode.includes("invalid_credentials")) {
    return "Email ou mot de passe incorrect. Vérifiez le mot de passe défini dans Supabase Auth.";
  }

  if (rawMessage.includes("signup disabled") || rawCode.includes("signup_disabled")) {
    return "Les inscriptions sont désactivées dans Supabase Auth.";
  }

  if (rawMessage.includes("expired") || rawCode.includes("otp_expired")) {
    return "Le lien de réinitialisation a expiré. Envoyez un nouveau lien depuis la page Connexion.";
  }

  return error?.message || "Connexion impossible. Vérifiez l'email et le mot de passe.";
}

function getSiteBasePath() {
  const root = document.body.dataset.root || ".";
  const currentDirectory = window.location.pathname.replace(/\/[^/]*$/, "");
  if (root === "..") return currentDirectory.replace(/\/[^/]*$/, "") || "/";
  return currentDirectory || "/";
}

function getAuthRedirectUrl(page = "auth/reset-password.html") {
  const basePath = getSiteBasePath().replace(/\/$/, "");
  return `${window.location.origin}${basePath}/${page}`.replace(/([^:]\/)\/+/g, "$1");
}

function renderSessionNav() {
  const session = getCurrentUser();
  if (!session || session.status !== "active") return "";

  const isAdmin = session.role === "admin";
  const href = isAdmin ? route("admin/index.html") : route("adherent/index.html");
  const label = isAdmin ? "Administration" : "Espace adhérent";
  const navKey = isAdmin ? "admin" : "adherent";

  return `
    <a href="${href}" class="nav-link session-link" data-nav="${navKey}">${label}</a>
    <button class="logout-button" type="button" data-logout>Déconnexion</button>
  `;
}

function renderLoginNav() {
  const session = getCurrentUser();
  if (session?.status === "active") return "";
  return `<a class="btn-primary" href="${route("auth/login.html")}" data-nav="auth" data-i18n="navLogin">Connexion</a>`;
}

function syncSessionNavigation() {
  const sessionMarkup = renderSessionNav();
  const hasSession = Boolean(sessionMarkup);

  if (hasSession) {
    document.querySelectorAll(`[href="${route("auth/login.html")}"]`).forEach((link) => {
      link.classList.add("hidden");
    });
  }

  if (!sessionMarkup || document.querySelector("[data-logout]")) return;

  document.querySelectorAll("#primary-menu").forEach((menu) => {
    const languageSelect = menu.querySelector("#language-select");
    if (!languageSelect) return;
    const wrapper = document.createElement("span");
    wrapper.dataset.sessionNav = "true";
    wrapper.className = "contents";
    wrapper.innerHTML = sessionMarkup;
    menu.insertBefore(wrapper, languageSelect);
  });

  document.querySelectorAll("#mobile-panel .grid").forEach((menu) => {
    const languageSelect = menu.querySelector("#mobile-language-select");
    if (!languageSelect) return;
    const wrapper = document.createElement("span");
    wrapper.dataset.sessionNav = "true";
    wrapper.className = "grid gap-3";
    wrapper.innerHTML = sessionMarkup;
    menu.insertBefore(wrapper, languageSelect);
  });
}

function requireSession() {
  const page = document.body.dataset.page;
  const requiredRole = protectedRoutes[page];
  if (!requiredRole) return true;

  const session = getCurrentUser();
  if (!session) {
    window.location.replace(route(`auth/login.html?next=${encodeURIComponent(page)}`));
    return false;
  }

  if (session.status !== "active") {
    window.location.replace(route("auth/login.html"));
    return false;
  }

  if (requiredRole === "admin" && session.role !== "admin") {
    window.location.replace(route("auth/login.html?next=admin"));
    return false;
  }

  document.body.classList.add("is-authorized");
  return true;
}

function renderSharedLayout() {
  const header = document.querySelector("[data-site-header]");
  const footer = document.querySelector("[data-site-footer]");

  if (header) {
    header.innerHTML = `
      <nav class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 lg:px-8" aria-label="Navigation principale">
        <a href="${route("index.html")}" class="flex min-w-0 items-center gap-3" aria-label="Bibliothèque Edgard Petit">
          <img src="${route("assets/logo.png")}" alt="Logo Bibliothèque Edgard Petit" class="h-12 w-auto shrink-0" />
          <span class="hidden text-sm font-semibold uppercase text-navy sm:block">Bibliothèque Edgard Petit</span>
        </a>
        <button id="mobile-menu-button" class="icon-button lg:hidden" type="button" aria-expanded="false" aria-controls="mobile-panel" aria-label="Ouvrir le menu"><span></span><span></span><span></span></button>
        <div id="primary-menu" class="hidden items-center gap-4 lg:flex">
          <a href="${route("index.html")}" class="nav-link" data-nav="home" data-i18n="navHome">Accueil</a>
          <a href="${route("pages/institution.html")}" class="nav-link" data-nav="institution" data-i18n="navInstitution">Institution</a>
          <a href="${route("pages/catalogue.html")}" class="nav-link" data-nav="catalogue" data-i18n="navCatalog">Catalogue</a>
          <a href="${route("pages/galerie.html")}" class="nav-link" data-nav="galerie">Galerie</a>
          <a href="${route("pages/agenda.html")}" class="nav-link" data-nav="agenda" data-i18n="navEvents">Événements</a>
          <a href="${route("pages/blog.html")}" class="nav-link" data-nav="blog" data-i18n="navBlog">Publications</a>
          ${renderSessionNav()}
          <select id="language-select" class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-navy" aria-label="Langue"><option value="fr">FR</option><option value="ht">HT</option><option value="en">EN</option></select>
          ${renderLoginNav()}
        </div>
      </nav>
      <div id="mobile-panel" class="hidden border-t border-slate-200 bg-white px-4 py-4 lg:hidden">
        <div class="grid gap-3">
          <a href="${route("index.html")}" class="nav-link" data-nav="home" data-i18n="navHome">Accueil</a>
          <a href="${route("pages/institution.html")}" class="nav-link" data-nav="institution" data-i18n="navInstitution">Institution</a>
          <a href="${route("pages/catalogue.html")}" class="nav-link" data-nav="catalogue" data-i18n="navCatalog">Catalogue</a>
          <a href="${route("pages/galerie.html")}" class="nav-link" data-nav="galerie">Galerie</a>
          <a href="${route("pages/agenda.html")}" class="nav-link" data-nav="agenda" data-i18n="navEvents">Événements</a>
          <a href="${route("pages/blog.html")}" class="nav-link" data-nav="blog" data-i18n="navBlog">Publications</a>
          ${renderSessionNav()}
          <select id="mobile-language-select" class="rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-semibold text-navy" aria-label="Langue mobile"><option value="fr">FR</option><option value="ht">HT</option><option value="en">EN</option></select>
          ${renderLoginNav()}
        </div>
      </div>
    `;
  }

  if (footer) {
    footer.innerHTML = `
      <div class="site-footer-inner">
        <div class="site-footer-brand">
          <img src="${route("assets/logo.png")}" alt="Bibliothèque Edgard Petit" />
          <p>La Bibliothèque Edgard Petit est un projet éducatif de l'Organisation de l'Union Haïtienne, dédié à l'accès au savoir, à la consultation sur place et à la formation.</p>
          <a href="https://www.ouhhaiti.org/" target="_blank" rel="noopener noreferrer">Visiter le site officiel OUH</a>
        </div>

        <nav class="site-footer-links" aria-label="Navigation pied de page">
          <h2>Navigation</h2>
          <a href="${route("index.html")}">Accueil</a>
          <a href="${route("pages/institution.html")}">Institution</a>
          <a href="${route("pages/catalogue.html")}">Catalogue</a>
          <a href="${route("pages/agenda.html")}">Événements</a>
          <a href="${route("pages/blog.html")}">Publications</a>
          <a href="${route("pages/galerie.html")}">Galerie</a>
        </nav>

        <div class="site-footer-links">
          <h2>Espaces</h2>
          <a href="${route("auth/login.html?next=adherent")}">Espace adhérent</a>
          <a href="${route("auth/login.html?next=admin")}">Accès équipe</a>
          <a href="${route("auth/login.html")}">Demande d'inscription</a>
        </div>

        <address class="site-footer-address">
          <h2>Adresse</h2>
          <p>Bibliothèque Edgard Petit</p>
          <p>390, Avenue John Brown</p>
          <p>Bourdon, Port-au-Prince, Haïti</p>
          <p>Contact : +509 4687-8125</p>
        </address>
      </div>
      <div class="site-footer-legal">
        <p>© ${new Date().getFullYear()} Bibliothèque Edgard Petit / Organisation de l'Union Haïtienne. Tous droits réservés.</p>
        <p>Les contenus publiés sur ce site sont fournis à titre informatif et éducatif. Toute reproduction ou diffusion doit respecter les droits des auteurs, intervenants et photographes.</p>
        <div>
          <a href="${route("legal/mentions-legales.html")}">Mentions légales</a>
          <a href="${route("legal/confidentialite.html")}">Confidentialité</a>
          <a href="${route("legal/conditions-utilisation.html")}">Conditions d'utilisation</a>
        </div>
      </div>
    `;
  }
}

function markCurrentPage() {
  const currentPage = document.body.dataset.page;
  document.querySelectorAll(`[data-nav="${currentPage}"]`).forEach((link) => {
    link.classList.add("is-active");
    link.setAttribute("aria-current", "page");
  });
}

const formatCurrency = (value) =>
  new Intl.NumberFormat("fr-HT", {
    style: "currency",
    currency: "HTG",
    maximumFractionDigits: 0
  }).format(value);

function getCurrentCatalogRotation() {
  return Math.floor(Date.now() / publicCatalogRotationMs);
}

function getStableBookScore(book, rotation) {
  const input = `${rotation}-${book.number}-${book.title}`;
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 31 + input.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function getPublicCatalogBooks() {
  const rotation = getCurrentCatalogRotation();
  return [...state.content.books]
    .sort((first, second) => getStableBookScore(first, rotation) - getStableBookScore(second, rotation))
    .slice(0, publicCatalogLimit);
}

function hasPrivateAccess() {
  return getCurrentUser()?.status === "active";
}

function getCatalogSourceBooks() {
  return hasPrivateAccess() ? state.content.books : getPublicCatalogBooks();
}

function calculateDiscount(memberCode = "") {
  const normalized = memberCode.trim().toUpperCase();
  const match = state.content.discounts.find((discount) => normalized.startsWith(discount.prefix));
  return match?.percentage || 0;
}

function renderOptions(select, values) {
  if (!select) return;
  select.innerHTML = "";
  const allOption = new Option(state.dictionary.all, "");
  select.append(allOption);
  values.forEach((value) => select.append(new Option(value, value)));
}

function setupFilters() {
  if (!document.querySelector("#catalog-filters")) return;
  const catalogBooks = getCatalogSourceBooks();
  const categories = [...new Set(catalogBooks.map((book) => book.category).filter(Boolean))].sort();

  renderOptions(document.querySelector("#category-filter"), categories);
}

function getPublicEvents() {
  return state.content.events
    .filter((event) => event.status === "published" && event.visibility === "public")
    .sort((first, second) => new Date(first.date) - new Date(second.date));
}

function getPublishedEvents() {
  return state.content.events
    .filter((event) => event.status === "published")
    .sort((first, second) => new Date(first.date) - new Date(second.date));
}

function getPublicEventShowcase() {
  const now = Date.now();
  const publicEvents = getPublicEvents();
  const closestEvent = [...publicEvents].sort(
    (first, second) => Math.abs(new Date(first.date) - now) - Math.abs(new Date(second.date) - now)
  )[0];
  const closestPastEvent = [...publicEvents]
    .filter((event) => new Date(event.date).getTime() < now)
    .sort((first, second) => new Date(second.date) - new Date(first.date))[0];
  const closestFutureEvent = [...publicEvents]
    .filter((event) => new Date(event.date).getTime() >= now)
    .sort((first, second) => new Date(first.date) - new Date(second.date))[0];

  const selected = [closestEvent, closestPastEvent, closestFutureEvent].filter(Boolean);
  const uniqueEvents = [];
  selected.forEach((event) => {
    if (!uniqueEvents.some((item) => item.id === event.id)) uniqueEvents.push(event);
  });

  if (uniqueEvents.length < 3) {
    [...publicEvents]
      .sort((first, second) => Math.abs(new Date(first.date) - now) - Math.abs(new Date(second.date) - now))
      .forEach((event) => {
        if (uniqueEvents.length >= 3) return;
        if (!uniqueEvents.some((item) => item.id === event.id)) uniqueEvents.push(event);
      });
  }

  return uniqueEvents.slice(0, 3).sort((first, second) => new Date(first.date) - new Date(second.date));
}

function getEventSourceEvents() {
  return hasPrivateAccess() ? getPublishedEvents() : getPublicEventShowcase();
}

function setupEventFilters() {
  if (!document.querySelector("#event-filters")) return;
  const types = [...new Set(getEventSourceEvents().map((event) => event.type))].sort();
  renderOptions(document.querySelector("#event-type-filter"), types);
}

function getPublishedGalleryItems() {
  return state.content.galleryItems
    .filter((item) => item.status === "published")
    .sort((first, second) => new Date(second.publishedAt) - new Date(first.publishedAt));
}

function setupGalleryFilters() {
  if (!document.querySelector("#gallery-filters")) return;
  const albums = [...new Set(getPublishedGalleryItems().map((item) => item.album))].sort();
  renderOptions(document.querySelector("#gallery-album-filter"), albums);
}

function getFilteredBooks() {
  const query = document.querySelector("#book-search")?.value.trim().toLowerCase() || "";
  const category = document.querySelector("#category-filter")?.value || "";

  return sortBooksAlphabetically(
    getCatalogSourceBooks().filter((book) => {
      const haystack = `${book.title} ${book.category}`.toLowerCase();
      return (
        (!query || haystack.includes(query)) &&
        (!category || book.category === category)
      );
    })
  );
}

function sortBooksAlphabetically(books) {
  return [...books].sort((first, second) =>
    `${first.title || ""}`.localeCompare(`${second.title || ""}`, "fr", { sensitivity: "base" })
  );
}

function getBookCountLabel(count) {
  return `${count} livre${count > 1 ? "s" : ""}`;
}

function renderCatalogTable(table, books) {
  if (!table) return;
  const showLocation = table.dataset.showLocation === "true" || document.body.dataset.page === "admin";
  const columnCount = showLocation ? 6 : 5;
  if (!books.length) {
    renderEmptyRow(table, columnCount, state.dictionary.noBooks);
    return;
  }

  table.querySelector("tbody").innerHTML = books
    .map((book) => `
      <tr>
        ${showLocation ? `<td>${escapeHtml(book.location || "-")}</td>` : ""}
        <td><button class="book-row-button book-title-button" type="button" data-book-open="${escapeHtml(book.id)}">${escapeHtml(book.title || "-")}</button></td>
        <td>${escapeHtml(book.category || "-")}</td>
        <td>${escapeHtml(book.author || "-")}</td>
        <td>${escapeHtml(book.edition || "-")}</td>
        <td>${escapeHtml(book.language || "-")}</td>
      </tr>
    `)
    .join("");
}

function getPaginatedItems(items, page) {
  const totalPages = Math.max(Math.ceil(items.length / catalogPageSize), 1);
  const safePage = Math.min(Math.max(page, 1), totalPages);
  const start = (safePage - 1) * catalogPageSize;
  return {
    page: safePage,
    totalPages,
    totalItems: items.length,
    start: items.length ? start + 1 : 0,
    end: Math.min(start + catalogPageSize, items.length),
    items: items.slice(start, start + catalogPageSize)
  };
}

function renderPagination(container, pageInfo, onPageChange) {
  if (!container) return;
  if (pageInfo.totalPages <= 1) {
    container.innerHTML = "";
    return;
  }

  container.innerHTML = `
    <button class="mini-action" type="button" data-page-prev ${pageInfo.page <= 1 ? "disabled" : ""}>Précédent</button>
    <span>Livres ${pageInfo.start}-${pageInfo.end} sur ${pageInfo.totalItems} · Page ${pageInfo.page} / ${pageInfo.totalPages}</span>
    <button class="mini-action" type="button" data-page-next ${pageInfo.page >= pageInfo.totalPages ? "disabled" : ""}>Suivant</button>
  `;

  container.querySelector("[data-page-prev]")?.addEventListener("click", () => onPageChange(pageInfo.page - 1));
  container.querySelector("[data-page-next]")?.addEventListener("click", () => onPageChange(pageInfo.page + 1));
}

function getRelatedBookPosts(book) {
  const bookTitle = `${book.title || ""}`.toLowerCase();
  const bookCategory = `${book.category || ""}`.toLowerCase();
  return state.content.posts
    .filter((post) => post.status === "published")
    .filter((post) => {
      const haystack = `${post.title} ${post.excerpt} ${post.content} ${post.category}`.toLowerCase();
      return (bookTitle && haystack.includes(bookTitle)) || (bookCategory && post.category.toLowerCase() === bookCategory);
    })
    .slice(0, 5);
}

function setupBookDetailsDialog() {
  if (document.querySelector("[data-book-dialog]")) return;

  const dialog = document.createElement("div");
  dialog.className = "book-detail-dialog hidden";
  dialog.dataset.bookDialog = "true";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Détails de l'ouvrage");
  dialog.innerHTML = `
    <article class="book-detail-panel">
      <button class="dialog-close" type="button" data-book-close aria-label="Fermer">×</button>
      <p class="eyebrow" data-book-category></p>
      <h2 data-book-title></h2>
      <dl class="book-detail-grid">
        <div data-book-location-block><dt>Emplacement</dt><dd data-book-location></dd></div>
        <div><dt>Auteur</dt><dd data-book-author></dd></div>
        <div><dt>Édition</dt><dd data-book-edition></dd></div>
        <div><dt>Langue</dt><dd data-book-language></dd></div>
      </dl>
      <section>
        <h3>Résumé</h3>
        <p data-book-summary></p>
      </section>
      <section>
        <h3>Description</h3>
        <p data-book-description></p>
      </section>
      <section>
        <h3>Publications liées</h3>
        <div class="book-related-posts" data-book-posts></div>
      </section>
      <form class="book-detail-edit-form hidden" data-book-edit-form>
        <h3>Modifier la fiche</h3>
        <label><span>Titre</span><input type="text" data-book-edit-title required /></label>
        <label><span>Catégorie/Sujet</span><input type="text" data-book-edit-category /></label>
        <label><span>Auteur</span><input type="text" data-book-edit-author /></label>
        <label><span>Édition</span><input type="text" data-book-edit-edition /></label>
        <label><span>Langue</span><input type="text" data-book-edit-language /></label>
        <label class="full"><span>Résumé</span><textarea rows="4" data-book-edit-summary></textarea></label>
        <label class="full"><span>Description</span><textarea rows="5" data-book-edit-description></textarea></label>
        <p class="auth-success hidden full" data-book-edit-message></p>
        <div class="book-detail-actions full">
          <button class="btn-glass-primary" type="submit">Enregistrer la fiche</button>
        </div>
      </form>
    </article>
  `;
  document.body.append(dialog);

  const closeDialog = () => {
    dialog.classList.add("hidden");
    document.body.classList.remove("flyer-lightbox-open");
  };

  dialog.querySelector("[data-book-close]")?.addEventListener("click", closeDialog);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closeDialog();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.classList.contains("hidden")) closeDialog();
  });

  const editForm = dialog.querySelector("[data-book-edit-form]");
  editForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = editForm.querySelector("[data-book-edit-message]");
    const submit = editForm.querySelector("button[type='submit']");
    const bookId = editForm.dataset.bookId;
    if (!bookId) return;

    const payload = {
      title: editForm.querySelector("[data-book-edit-title]")?.value.trim() || "",
      category: editForm.querySelector("[data-book-edit-category]")?.value.trim() || "Catalogue",
      author: editForm.querySelector("[data-book-edit-author]")?.value.trim() || "",
      edition: editForm.querySelector("[data-book-edit-edition]")?.value.trim() || "",
      language: editForm.querySelector("[data-book-edit-language]")?.value.trim() || "",
      summary: editForm.querySelector("[data-book-edit-summary]")?.value.trim() || "",
      description: editForm.querySelector("[data-book-edit-description]")?.value.trim() || ""
    };

    if (!payload.title) {
      showAuthMessage(message, "Le titre du livre est obligatoire.", "error");
      return;
    }

    submit?.setAttribute("disabled", "true");
    if (submit) submit.textContent = "Enregistrement...";

    try {
      const client = await getSupabaseClient();
      if (!client) throw new Error("supabase_unavailable");
      const { error } = await client.rpc("update_book_detail", {
        target_book_id: bookId,
        target_title: payload.title,
        target_author: payload.author,
        target_edition: payload.edition,
        target_language: payload.language,
        target_category: payload.category,
        target_summary: payload.summary,
        target_description: payload.description
      });
      if (error) throw error;

      const updateBook = (book) => (`${book.id}` === `${bookId}` || (`${book.detailId || ""}` && `${book.detailId}` === `${editForm.dataset.detailId || ""}`))
        ? { ...book, ...payload }
        : book;
      state.adminCatalogBooks = state.adminCatalogBooks.map(updateBook);
      state.content.books = state.content.books.map(updateBook);
      renderAdminCatalogTable();
      renderBooks();
      openBookDetails(bookId);
      showAuthMessage(dialog.querySelector("[data-book-edit-message]"), "Fiche enregistrée.");
    } catch (error) {
      console.warn("Modification de fiche livre impossible.", error);
      const raw = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
      const text = raw.includes("permission") || raw.includes("denied")
        ? "Accès refusé. Le compte doit avoir le droit books.import.excel."
        : "Enregistrement impossible pour le moment.";
      showAuthMessage(message, text, "error");
    } finally {
      submit?.removeAttribute("disabled");
      if (submit) submit.textContent = "Enregistrer la fiche";
    }
  });
}

function openBookDetails(bookId) {
  const dialog = document.querySelector("[data-book-dialog]");
  const source = state.adminCatalogBooks.length ? state.adminCatalogBooks : getCatalogSourceBooks();
  const book = source.find((item) => `${item.id}` === `${bookId}`);
  if (!dialog || !book) return;

  const relatedPosts = getRelatedBookPosts(book);
  const showLocation = canEditCatalogBooks();
  dialog.querySelector("[data-book-category]").textContent = book.category || "Catalogue";
  dialog.querySelector("[data-book-title]").textContent = book.title || "Ouvrage";
  dialog.querySelector("[data-book-location-block]")?.classList.toggle("hidden", !showLocation);
  dialog.querySelector("[data-book-location]").textContent = showLocation ? (book.location || "-") : "";
  dialog.querySelector("[data-book-author]").textContent = book.author || "-";
  dialog.querySelector("[data-book-edition]").textContent = book.edition || "-";
  dialog.querySelector("[data-book-language]").textContent = book.language || "-";
  dialog.querySelector("[data-book-summary]").textContent = book.summary || "Résumé non renseigné par l'administration.";
  dialog.querySelector("[data-book-description]").textContent = book.description || "Description non renseignée par l'administration.";
  dialog.querySelector("[data-book-posts]").innerHTML = relatedPosts.length
    ? relatedPosts.map((post) => `<a href="${route(`pages/blog.html#${post.id}`)}">${escapeHtml(post.title)}</a>`).join("")
    : "<p>Aucune publication liée pour le moment.</p>";

  const editForm = dialog.querySelector("[data-book-edit-form]");
  if (editForm) {
    const editable = canEditCatalogBooks();
    editForm.classList.toggle("hidden", !editable);
    editForm.dataset.bookId = book.id || "";
    editForm.dataset.detailId = book.detailId || "";
    editForm.querySelector("[data-book-edit-title]").value = book.title || "";
    editForm.querySelector("[data-book-edit-category]").value = book.category || "";
    editForm.querySelector("[data-book-edit-author]").value = book.author || "";
    editForm.querySelector("[data-book-edit-edition]").value = book.edition || "";
    editForm.querySelector("[data-book-edit-language]").value = book.language || "";
    editForm.querySelector("[data-book-edit-summary]").value = book.summary || "";
    editForm.querySelector("[data-book-edit-description]").value = book.description || "";
    editForm.querySelector("[data-book-edit-message]")?.classList.add("hidden");
  }
  dialog.classList.remove("hidden");
  document.body.classList.add("flyer-lightbox-open");
  dialog.querySelector("[data-book-close]")?.focus();
}

function getFilteredEvents() {
  const query = document.querySelector("#event-search")?.value.trim().toLowerCase() || "";
  const type = document.querySelector("#event-type-filter")?.value || "";
  const priceFilter = document.querySelector("#event-price-filter")?.value || "";

  return getEventSourceEvents().filter((event) => {
    const haystack = `${event.title} ${event.description} ${event.location} ${event.type}`.toLowerCase();
    const matchesPrice =
      !priceFilter ||
      (priceFilter === "free" && event.basePrice === 0) ||
      (priceFilter === "paid" && event.basePrice > 0);

    return (!query || haystack.includes(query)) && (!type || event.type === type) && matchesPrice;
  });
}

function getFilteredGalleryItems() {
  const query = document.querySelector("#gallery-search")?.value.trim().toLowerCase() || "";
  const album = document.querySelector("#gallery-album-filter")?.value || "";

  return getPublishedGalleryItems().filter((item) => {
    const haystack = `${item.title} ${item.description} ${item.album}`.toLowerCase();
    return (!query || haystack.includes(query)) && (!album || item.album === album);
  });
}

function renderBooks() {
  const grid = document.querySelector("#books-grid");
  const table = document.querySelector("#books-table");
  const catalogCount = document.querySelector("#catalog-count");
  if ((!grid && !table) || !catalogCount) return;
  const filteredBooks = getFilteredBooks();
  const publicNotice = document.querySelector("#catalog-public-notice");
  const fullCatalogLink = document.querySelector("#full-catalog-link");

  if (hasPrivateAccess()) {
    catalogCount.textContent = state.dictionary.bookCount.replace("{count}", getCatalogSourceBooks().length);
    publicNotice?.classList.add("hidden");
    fullCatalogLink?.classList.add("hidden");
  } else {
    catalogCount.textContent = `${getCatalogSourceBooks().length} livres visibles sur la vitrine`;
    publicNotice?.classList.remove("hidden");
    fullCatalogLink?.classList.remove("hidden");
  }

  if (table) {
    const pageInfo = getPaginatedItems(filteredBooks, state.catalogPage);
    state.catalogPage = pageInfo.page;
    renderCatalogTable(table, pageInfo.items);
    renderPagination(document.querySelector("[data-catalog-pagination]"), pageInfo, (page) => {
      state.catalogPage = page;
      renderBooks();
    });
    return;
  }

  if (!grid) return;
  if (!filteredBooks.length) {
    grid.innerHTML = `<p class="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">${state.dictionary.noBooks}</p>`;
    return;
  }

  grid.innerHTML = filteredBooks
    .map(
      (book) => `
        <article class="book-card">
          <span class="badge">${book.category}</span>
          <h3 class="mt-4 text-xl">${book.title}</h3>
          <p>${book.author}</p>
          <dl class="mt-4 grid grid-cols-2 gap-3 text-sm">
            <div><dt class="font-bold text-slate-500">${state.dictionary.editionLabel}</dt><dd class="font-semibold text-navy">${book.edition}</dd></div>
            <div><dt class="font-bold text-slate-500">${state.dictionary.languageLabel}</dt><dd class="font-semibold text-navy">${book.language}</dd></div>
          </dl>
          <span class="location">${book.location}</span>
        </article>
      `
    )
    .join("");
}

function renderEvents() {
  const grid = document.querySelector("#events-grid");
  if (!grid) return;
  const filteredEvents = getFilteredEvents();

  if (!filteredEvents.length) {
    grid.innerHTML = `<p class="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">Aucun événement publié ne correspond aux filtres.</p>`;
    return;
  }

  grid.innerHTML = filteredEvents
    .map((event) => {
      const date = new Intl.DateTimeFormat(state.language === "en" ? "en-US" : "fr-FR", {
        dateStyle: "medium",
        timeStyle: "short"
      }).format(new Date(event.date));
      const price = event.basePrice === 0 ? state.dictionary.free : formatCurrency(event.basePrice);
      const remainingSeats = Math.max(event.capacity - event.registered, 0);
      const seatStatus = remainingSeats <= 5 ? "warning" : "success";
      const registerHref = hasPrivateAccess() ? route("adherent/index.html#event-registration") : route("auth/login.html?next=adherent");
      const registerLabel = hasPrivateAccess() ? state.dictionary.register : "Connexion pour s'inscrire";

      return `
        <article class="event-card">
          <button class="event-flyer-button" type="button" data-flyer-id="${event.id}" aria-label="Voir le flyer">
            <img class="event-flyer" src="${resolveAssetPath(event.flyer || "./assets/edgard-petit.jpg")}" alt="${event.flyerAlt || event.title}" loading="lazy" />
            <span>Voir le flyer</span>
          </button>
          <div class="event-card-top">
            <span class="badge">${event.type}</span>
            <span class="status-pill ${seatStatus}">${remainingSeats} places restantes</span>
          </div>
          <h3 class="mt-4 text-xl">${event.title}</h3>
          <p>${event.description}</p>
          <dl class="event-meta">
            <div><dt>Date</dt><dd>${date}</dd></div>
            <div><dt>Lieu</dt><dd>${event.location}</dd></div>
            <div><dt>Capacité</dt><dd>${event.registered}/${event.capacity} inscrits</dd></div>
          </dl>
          <div class="event-price">${price}</div>
          <label class="field mt-5">
            <span>${state.dictionary.memberCode}</span>
            <input data-event-code="${event.id}" type="text" placeholder="Votre code adhérent" autocomplete="off" />
          </label>
          <div class="mt-3 rounded-md bg-mist p-3 text-sm font-semibold text-navy" data-event-result="${event.id}">
            ${state.dictionary.finalPrice}: ${price}
          </div>
          <p class="mt-4 text-xs leading-5 text-slate-500">${event.paymentRequired ? state.dictionary.paymentInstructions : "Inscription gratuite, confirmation dans l'espace adhérent."}</p>
          <a class="btn-primary mt-auto" href="${registerHref}">${registerLabel}</a>
        </article>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-event-code]").forEach((input) => {
    input.addEventListener("input", (event) => {
      const codeInput = event.currentTarget;
      const selectedEvent = filteredEvents.find((item) => item.id === codeInput.dataset.eventCode);
      if (!selectedEvent) return;
      const result = grid.querySelector(`[data-event-result="${selectedEvent.id}"]`);
      if (!result) return;
      const discount = calculateDiscount(codeInput.value);
      const finalPrice = selectedEvent.basePrice * (1 - discount / 100);
      const renderedPrice = selectedEvent.basePrice === 0 ? state.dictionary.free : formatCurrency(finalPrice);
      result.textContent = `${state.dictionary.finalPrice}: ${renderedPrice}${discount ? ` (${discount}% ${state.dictionary.discountApplied})` : ""}`;
    });
  });
}

function setupFlyerLightbox() {
  if (!document.querySelector("#events-grid")) return;

  const lightbox = document.createElement("div");
  lightbox.className = "flyer-lightbox hidden";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Visionneuse de flyer");
  lightbox.innerHTML = `
    <div class="flyer-lightbox-shell">
      <div class="flyer-toolbar">
        <strong data-flyer-title>Flyer</strong>
        <div class="flyer-actions">
          <button type="button" data-flyer-zoom-out aria-label="Réduire">-</button>
          <button type="button" data-flyer-reset aria-label="Réinitialiser le zoom">100%</button>
          <button type="button" data-flyer-zoom-in aria-label="Agrandir">+</button>
          <a href="#" data-flyer-download download>Télécharger</a>
          <button type="button" data-flyer-close aria-label="Fermer">×</button>
        </div>
      </div>
      <div class="flyer-stage" data-flyer-stage>
        <img src="" alt="" data-flyer-image />
      </div>
    </div>
  `;
  document.body.append(lightbox);

  const title = lightbox.querySelector("[data-flyer-title]");
  const image = lightbox.querySelector("[data-flyer-image]");
  const download = lightbox.querySelector("[data-flyer-download]");
  const resetButton = lightbox.querySelector("[data-flyer-reset]");
  const stage = lightbox.querySelector("[data-flyer-stage]");
  let zoom = 1;
  let baseImageWidth = 0;

  const setZoom = (value) => {
    zoom = Math.min(Math.max(value, 0.6), 2.8);
    if (baseImageWidth) {
      image.style.maxWidth = "none";
      image.style.maxHeight = "none";
      image.style.width = `${baseImageWidth * zoom}px`;
    }
    resetButton.textContent = `${Math.round(zoom * 100)}%`;
  };

  const setZoomAtPoint = (value, clientX, clientY) => {
    if (!stage || !baseImageWidth) {
      setZoom(value);
      return;
    }

    const previousRect = image.getBoundingClientRect();
    const relativeX = Math.min(Math.max((clientX - previousRect.left) / previousRect.width, 0), 1);
    const relativeY = Math.min(Math.max((clientY - previousRect.top) / previousRect.height, 0), 1);

    setZoom(value);

    requestAnimationFrame(() => {
      const nextRect = image.getBoundingClientRect();
      const nextX = nextRect.left + nextRect.width * relativeX;
      const nextY = nextRect.top + nextRect.height * relativeY;
      stage.scrollLeft += nextX - clientX;
      stage.scrollTop += nextY - clientY;
    });
  };

  const closeLightbox = () => {
    lightbox.classList.add("hidden");
    document.body.classList.remove("flyer-lightbox-open");
    image.src = "";
    baseImageWidth = 0;
    image.removeAttribute("style");
    setZoom(1);
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-flyer-id]");
    if (!button) return;

    const selectedEvent = state.content.events.find((item) => item.id === button.dataset.flyerId);
    if (!selectedEvent) return;

    const flyer = resolveAssetPath(selectedEvent.flyer || "./assets/edgard-petit.jpg");
    title.textContent = selectedEvent.title;
    const prepareImageZoom = () => {
      image.removeAttribute("style");
      baseImageWidth = image.getBoundingClientRect().width;
      setZoom(1);
    };

    image.onload = prepareImageZoom;
    image.src = flyer;
    image.alt = selectedEvent.flyerAlt || selectedEvent.title;
    download.href = flyer;
    download.setAttribute("download", flyer.split("/").pop() || "flyer.png");
    lightbox.classList.remove("hidden");
    document.body.classList.add("flyer-lightbox-open");
    if (image.complete) requestAnimationFrame(prepareImageZoom);
    lightbox.querySelector("[data-flyer-close]")?.focus();
  });

  lightbox.querySelector("[data-flyer-close]")?.addEventListener("click", closeLightbox);
  lightbox.querySelector("[data-flyer-zoom-out]")?.addEventListener("click", () => setZoom(zoom - 0.2));
  lightbox.querySelector("[data-flyer-zoom-in]")?.addEventListener("click", () => setZoom(zoom + 0.2));
  resetButton?.addEventListener("click", () => setZoom(1));
  stage?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeLightbox();
  });

  stage?.addEventListener(
    "wheel",
    (event) => {
      if (lightbox.classList.contains("hidden")) return;
      event.preventDefault();
      const direction = event.deltaY < 0 ? 1 : -1;
      setZoomAtPoint(zoom + direction * 0.15, event.clientX, event.clientY);
    },
    { passive: false }
  );

  document.addEventListener("keydown", (event) => {
    if (lightbox.classList.contains("hidden")) return;
    if (event.key === "Escape") closeLightbox();
    if (event.key === "+" || event.key === "=") setZoom(zoom + 0.2);
    if (event.key === "-") setZoom(zoom - 0.2);
  });
}

function renderPosts() {
  const grid = document.querySelector("#blog-grid");
  if (!grid) return;
  const publishedPosts = state.content.posts.filter((post) => post.status === "published");

  grid.innerHTML = publishedPosts
    .map(
      (post) => `
        <article class="blog-card">
          <img class="blog-cover" src="${resolveAssetPath(post.cover || "./assets/edgard-petit.jpg")}" alt="${post.coverAlt || post.title}" loading="lazy" />
          <div class="blog-card-head">
            <span class="badge">${post.category}</span>
            <time datetime="${post.publishedAt}">${new Intl.DateTimeFormat(state.language === "en" ? "en-US" : "fr-FR", { dateStyle: "medium" }).format(new Date(post.publishedAt))}</time>
          </div>
          <h3 class="mt-4 text-xl">${post.title}</h3>
          <p>${post.excerpt}</p>
          <dl class="mt-5 grid gap-3 text-sm">
            <div><dt class="font-bold text-slate-500">${state.dictionary.author}</dt><dd class="font-semibold text-navy">${post.authorName}</dd></div>
            <div><dt class="font-bold text-slate-500">${state.dictionary.auditor}</dt><dd class="font-semibold text-navy">${post.auditorName}</dd></div>
          </dl>
          <div class="blog-actions">
            <button class="btn-glass-primary" type="button" data-post-open="${post.id}">Lire la publication</button>
            <button class="btn-glass-secondary" type="button" data-post-share="${post.id}">Partager</button>
          </div>
          <div class="share-row" aria-label="Partager la publication">
            ${renderShareLinks(post)}
          </div>
        </article>
      `
    )
    .join("");
}

function renderGallery() {
  const grid = document.querySelector("#gallery-grid");
  if (!grid) return;

  const filteredItems = getFilteredGalleryItems();
  if (!filteredItems.length) {
    grid.innerHTML = `<p class="rounded-lg border border-slate-200 bg-white p-5 text-slate-600">Aucune photo publiée ne correspond aux filtres.</p>`;
    return;
  }

  grid.innerHTML = filteredItems
    .map(
      (item) => `
        <figure>
          <button class="gallery-photo-button" type="button" data-gallery-id="${item.id}" aria-label="Voir la photo">
            <img src="${resolveAssetPath(item.src)}" alt="${item.alt}" loading="lazy" />
          </button>
          <figcaption>
            <strong>${item.title}</strong>
            <span>${item.album}</span>
          </figcaption>
        </figure>
      `
    )
    .join("");
}

function getPreviewImageUrl(form) {
  const file = form.querySelector("[data-preview-image]")?.files?.[0];
  return file ? URL.createObjectURL(file) : "";
}

function getPreviewValue(form, selector, fallback = "") {
  const value = form.querySelector(selector)?.value?.trim();
  return value || fallback;
}

function renderEventPreview(form) {
  const title = getPreviewValue(form, "[data-preview-title]", "Titre de l'événement");
  const type = getPreviewValue(form, "[data-preview-category]", "Événement");
  const description = getPreviewValue(form, "[data-preview-description]", "Description de l'événement");
  const date = getPreviewValue(form, "[data-preview-date]");
  const time = getPreviewValue(form, "[data-preview-time]");
  const capacity = Number(getPreviewValue(form, "[data-preview-capacity]", "0"));
  const priceValue = Number(getPreviewValue(form, "[data-preview-price]", "0"));
  const flyer = getPreviewImageUrl(form);
  const renderedDate = date
    ? new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: time ? "short" : undefined }).format(new Date(`${date}T${time || "00:00"}`))
    : "Date à définir";
  const flyerMarkup = flyer
    ? `<img class="event-flyer" src="${flyer}" alt="${escapeHtml(title)}" />`
    : `<div class="event-flyer preview-empty-media">Flyer non sélectionné</div>`;

  return `
    <article class="event-card preview-surface-card">
      <button class="event-flyer-button" type="button">
        ${flyerMarkup}
        <span>Voir le flyer</span>
      </button>
      <div class="event-card-top">
        <span class="badge">${escapeHtml(type)}</span>
        <span class="status-pill success">${capacity || 0} place${capacity > 1 ? "s" : ""}</span>
      </div>
      <h3 class="mt-4 text-xl">${escapeHtml(title)}</h3>
      <p>${escapeHtml(description)}</p>
      <dl class="event-meta">
        <div><dt>Date</dt><dd>${escapeHtml(renderedDate)}</dd></div>
        <div><dt>Lieu</dt><dd>Bibliothèque Edgard Petit</dd></div>
        <div><dt>Capacité</dt><dd>0/${capacity || 0} inscrits</dd></div>
      </dl>
      <div class="event-price">${priceValue ? formatCurrency(priceValue) : state.dictionary.free}</div>
      <a class="btn-primary mt-auto" href="#">Connexion pour s'inscrire</a>
    </article>
  `;
}

function renderPostPreview(form) {
  const title = getPreviewValue(form, "[data-preview-title]", "Titre de la publication");
  const category = getPreviewValue(form, "[data-preview-category]", "Publication");
  const author = getPreviewValue(form, "[data-preview-author]", "Auteur");
  const auditor = getPreviewValue(form, "[data-preview-auditor]", "Relecteur");
  const content = getPreviewValue(form, "[data-preview-description]", "Contenu de la publication");
  const cover = getPreviewImageUrl(form);
  const excerpt = content.length > 170 ? `${content.slice(0, 170)}...` : content;
  const coverMarkup = cover
    ? `<img class="blog-cover" src="${cover}" alt="${escapeHtml(title)}" />`
    : `<div class="blog-cover preview-empty-media">Image de couverture non sélectionnée</div>`;

  return `
    <article class="blog-card preview-surface-card">
      ${coverMarkup}
      <div class="blog-card-head">
        <span class="badge">${escapeHtml(category)}</span>
        <time>${new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date())}</time>
      </div>
      <h3 class="mt-4 text-xl">${escapeHtml(title)}</h3>
      <p>${escapeHtml(excerpt)}</p>
      <dl class="mt-5 grid gap-3 text-sm">
        <div><dt class="font-bold text-slate-500">Auteur</dt><dd class="font-semibold text-navy">${escapeHtml(author)}</dd></div>
        <div><dt class="font-bold text-slate-500">Relecture</dt><dd class="font-semibold text-navy">${escapeHtml(auditor)}</dd></div>
      </dl>
      <div class="blog-actions">
        <button class="btn-glass-primary" type="button">Lire la publication</button>
        <button class="btn-glass-secondary" type="button">Partager</button>
      </div>
    </article>
  `;
}

function renderGalleryPreview(form) {
  const title = getPreviewValue(form, "[data-preview-title]", "Titre de la photo");
  const album = getPreviewValue(form, "[data-preview-category]", "Album");
  const description = getPreviewValue(form, "[data-preview-description]", "Description de la photo");
  const src = getPreviewImageUrl(form);
  const mediaMarkup = src
    ? `<img src="${src}" alt="${escapeHtml(title)}" />`
    : `<div class="preview-gallery-empty preview-empty-media">Photo non sélectionnée</div>`;

  return `
    <figure class="preview-gallery-figure">
      ${mediaMarkup}
      <figcaption>
        <strong>${escapeHtml(title)}</strong>
        <span>${escapeHtml(album)}</span>
        <p>${escapeHtml(description)}</p>
      </figcaption>
    </figure>
  `;
}

function setupAdminPublishPreview() {
  const previewButtons = document.querySelectorAll("[data-open-preview]");
  if (!previewButtons.length || document.querySelector("[data-admin-preview-dialog]")) return;

  const dialog = document.createElement("div");
  dialog.className = "admin-live-preview-dialog hidden";
  dialog.dataset.adminPreviewDialog = "true";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Aperçu public");
  dialog.innerHTML = `
    <article class="admin-live-preview-panel">
      <button class="dialog-close" type="button" data-admin-preview-close aria-label="Fermer">×</button>
      <div class="dash-card-head">
        <div><p class="eyebrow">Aperçu public</p><h2 data-admin-preview-title>Prévisualisation</h2></div>
      </div>
      <div class="admin-preview-switcher" role="group" aria-label="Choisir la taille d'aperçu">
        <button type="button" data-preview-device="desktop" aria-pressed="true">Ordinateur</button>
        <button type="button" data-preview-device="tablet" aria-pressed="false">Tablette</button>
        <button type="button" data-preview-device="phone" aria-pressed="false">Smartphone</button>
      </div>
      <section class="admin-device-frame admin-device-desktop" data-admin-preview-frame>
        <span data-admin-preview-device-label>Ordinateur</span>
        <div data-admin-preview-stage></div>
      </section>
    </article>
  `;
  document.body.append(dialog);
  let activeDevice = "desktop";

  const closePreview = () => {
    dialog.classList.add("hidden");
    document.body.classList.remove("flyer-lightbox-open");
  };

  const setPreviewDevice = (device) => {
    activeDevice = device;
    const frame = dialog.querySelector("[data-admin-preview-frame]");
    const label = dialog.querySelector("[data-admin-preview-device-label]");
    const labels = { desktop: "Ordinateur", tablet: "Tablette", phone: "Smartphone" };
    frame.classList.remove("admin-device-desktop", "admin-device-tablet", "admin-device-phone");
    frame.classList.add(`admin-device-${device}`);
    if (label) label.textContent = labels[device] || "Ordinateur";
    dialog.querySelectorAll("[data-preview-device]").forEach((button) => {
      button.setAttribute("aria-pressed", String(button.dataset.previewDevice === device));
    });
  };

  const openPreview = (type, form) => {
    const stage = dialog.querySelector("[data-admin-preview-stage]");
    const title = dialog.querySelector("[data-admin-preview-title]");
    const renderers = {
      event: renderEventPreview,
      post: renderPostPreview,
      gallery: renderGalleryPreview
    };
    const labels = {
      event: "Événement sur la vitrine",
      post: "Publication sur la vitrine",
      gallery: "Photo dans la galerie"
    };

    if (!stage || !renderers[type]) return;
    title.textContent = labels[type] || "Prévisualisation";
    stage.innerHTML = renderers[type](form);
    setPreviewDevice(activeDevice);
    dialog.classList.remove("hidden");
    document.body.classList.add("flyer-lightbox-open");
    dialog.querySelector("[data-admin-preview-close]")?.focus();
  };

  previewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      const type = button.dataset.openPreview;
      const form = document.querySelector(`[data-preview-form="${type}"]`);
      if (form) openPreview(type, form);
    });
  });

  dialog.querySelector("[data-admin-preview-close]")?.addEventListener("click", closePreview);
  dialog.querySelectorAll("[data-preview-device]").forEach((button) => {
    button.addEventListener("click", () => setPreviewDevice(button.dataset.previewDevice || "desktop"));
  });
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closePreview();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.classList.contains("hidden")) closePreview();
  });
}

function getGalleryShareUrl(item) {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  return `${baseUrl}#${item.id}`;
}

function getGallerySocialUrl(platform, item) {
  const url = encodeURIComponent(getGalleryShareUrl(item));
  const text = encodeURIComponent(item.title);
  if (platform === "whatsapp") return `https://wa.me/?text=${text}%20${url}`;
  if (platform === "twitter") return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
  return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
}

function setupGalleryLightbox() {
  if (!document.querySelector("#gallery-grid")) return;

  const lightbox = document.createElement("div");
  lightbox.className = "gallery-lightbox hidden";
  lightbox.setAttribute("role", "dialog");
  lightbox.setAttribute("aria-modal", "true");
  lightbox.setAttribute("aria-label", "Visionneuse de galerie");
  lightbox.innerHTML = `
    <div class="gallery-lightbox-panel">
      <button class="dialog-close" type="button" data-gallery-close aria-label="Fermer">×</button>
      <button class="gallery-nav prev" type="button" data-gallery-prev aria-label="Photo précédente">‹</button>
      <img src="" alt="" data-gallery-image />
      <button class="gallery-nav next" type="button" data-gallery-next aria-label="Photo suivante">›</button>
      <div class="gallery-lightbox-caption">
        <span data-gallery-album></span>
        <h2 data-gallery-title></h2>
        <p data-gallery-description></p>
        <div class="share-row">
          <a href="#" data-gallery-whatsapp target="_blank" rel="noopener" aria-label="Partager sur WhatsApp" title="WhatsApp">${getShareIcon("whatsapp")}<span>WhatsApp</span></a>
          <a href="#" data-gallery-twitter target="_blank" rel="noopener" aria-label="Partager sur Twitter/X" title="Twitter/X">${getShareIcon("twitter")}<span>Twitter/X</span></a>
          <a href="#" data-gallery-facebook target="_blank" rel="noopener" aria-label="Partager sur Facebook" title="Facebook">${getShareIcon("facebook")}<span>Facebook</span></a>
          <button type="button" data-gallery-copy aria-label="Copier le lien" title="Copier le lien">${getShareIcon("link")}<span>Copier le lien</span></button>
          <a href="#" data-gallery-download download aria-label="Télécharger la photo" title="Télécharger">${getShareIcon("link")}<span>Télécharger</span></a>
        </div>
      </div>
    </div>
  `;
  document.body.append(lightbox);

  let activeItems = [];
  let activeIndex = 0;

  const renderActive = () => {
    const item = activeItems[activeIndex];
    if (!item) return;
    const image = lightbox.querySelector("[data-gallery-image]");
    image.src = item.src;
    image.alt = item.alt;
    lightbox.querySelector("[data-gallery-album]").textContent = item.album;
    lightbox.querySelector("[data-gallery-title]").textContent = item.title;
    lightbox.querySelector("[data-gallery-description]").textContent = item.description;
    lightbox.querySelector("[data-gallery-whatsapp]").href = getGallerySocialUrl("whatsapp", item);
    lightbox.querySelector("[data-gallery-twitter]").href = getGallerySocialUrl("twitter", item);
    lightbox.querySelector("[data-gallery-facebook]").href = getGallerySocialUrl("facebook", item);
    lightbox.querySelector("[data-gallery-copy]").dataset.galleryCopy = item.id;
    const download = lightbox.querySelector("[data-gallery-download]");
    download.href = item.src;
    download.setAttribute("download", item.src.split("/").pop() || "photo.jpg");
    window.location.hash = item.id;
  };

  const openGallery = (id) => {
    activeItems = getFilteredGalleryItems();
    activeIndex = Math.max(activeItems.findIndex((item) => item.id === id), 0);
    renderActive();
    lightbox.classList.remove("hidden");
    document.body.classList.add("flyer-lightbox-open");
    lightbox.querySelector("[data-gallery-close]")?.focus();
  };

  const closeGallery = () => {
    lightbox.classList.add("hidden");
    document.body.classList.remove("flyer-lightbox-open");
  };

  const moveGallery = (direction) => {
    if (!activeItems.length) return;
    activeIndex = (activeIndex + direction + activeItems.length) % activeItems.length;
    renderActive();
  };

  document.addEventListener("click", (event) => {
    const button = event.target.closest("[data-gallery-id]");
    if (button) openGallery(button.dataset.galleryId);
  });

  document.addEventListener("click", async (event) => {
    const copyButton = event.target.closest("[data-gallery-copy]");
    if (!copyButton) return;
    const item = state.content.galleryItems.find((entry) => entry.id === copyButton.dataset.galleryCopy);
    if (!item) return;
    await navigator.clipboard?.writeText(getGalleryShareUrl(item));
    copyButton.title = "Lien copié";
  });

  lightbox.querySelector("[data-gallery-close]")?.addEventListener("click", closeGallery);
  lightbox.querySelector("[data-gallery-prev]")?.addEventListener("click", () => moveGallery(-1));
  lightbox.querySelector("[data-gallery-next]")?.addEventListener("click", () => moveGallery(1));
  lightbox.addEventListener("click", (event) => {
    if (event.target === lightbox) closeGallery();
  });
  document.addEventListener("keydown", (event) => {
    if (lightbox.classList.contains("hidden")) return;
    if (event.key === "Escape") closeGallery();
    if (event.key === "ArrowLeft") moveGallery(-1);
    if (event.key === "ArrowRight") moveGallery(1);
  });

  const hashItem = state.content.galleryItems.find((item) => `#${item.id}` === window.location.hash && item.status === "published");
  if (hashItem) openGallery(hashItem.id);
}

function getPostUrl(post) {
  const baseUrl = `${window.location.origin}${window.location.pathname}`;
  return `${baseUrl}#${post.id}`;
}

function getShareUrl(platform, post) {
  const url = encodeURIComponent(getPostUrl(post));
  const text = encodeURIComponent(post.title);
  const summary = encodeURIComponent(`${post.title} - Bibliothèque Edgard Petit`);

  if (platform === "whatsapp") return `https://wa.me/?text=${summary}%20${url}`;
  if (platform === "twitter") return `https://twitter.com/intent/tweet?text=${text}&url=${url}`;
  return `https://www.facebook.com/sharer/sharer.php?u=${url}`;
}

function getShareIcon(platform) {
  const icons = {
    whatsapp:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.04 2.2A9.75 9.75 0 0 0 3.6 16.82L2.4 21.8l5.08-1.18a9.75 9.75 0 1 0 4.56-18.42Zm0 1.9a7.84 7.84 0 0 1 6.67 11.96 7.8 7.8 0 0 1-9.06 2.8l-.34-.14-3.68.86.87-3.57-.18-.36A7.84 7.84 0 0 1 12.04 4.1Zm-3.2 3.9c-.18 0-.46.06-.7.32-.24.26-.92.9-.92 2.2 0 1.29.95 2.54 1.08 2.72.13.18 1.84 2.94 4.55 4 .56.22 1 .35 1.34.45.56.18 1.07.15 1.47.09.45-.07 1.4-.57 1.6-1.12.2-.55.2-1.03.14-1.12-.06-.1-.22-.16-.46-.28-.24-.12-1.4-.69-1.62-.77-.22-.08-.38-.12-.54.12-.16.24-.62.77-.76.93-.14.16-.28.18-.52.06-.24-.12-1.02-.38-1.94-1.2-.72-.64-1.2-1.43-1.34-1.67-.14-.24-.02-.37.1-.49.11-.11.24-.28.36-.42.12-.14.16-.24.24-.4.08-.16.04-.3-.02-.42-.06-.12-.54-1.3-.74-1.78-.2-.47-.39-.41-.54-.42h-.46Z"/></svg>',
    twitter:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.28 10.16 22.12 1h-1.86l-6.8 7.95L8.02 1H1.75l8.22 12.02L1.75 22.6h1.86l7.18-8.38 5.73 8.38h6.27l-8.51-12.44Zm-2.54 2.96-.83-1.19L4.28 2.41h2.85l5.35 7.68.83 1.19 6.96 9.99h-2.85l-5.68-8.15Z"/></svg>',
    facebook:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 8.2V6.6c0-.76.38-1.15 1.22-1.15h1.64V2.62A22.2 22.2 0 0 0 14.47 2c-2.37 0-4 1.45-4 4.1v2.1H7.78v3.17h2.69V22h3.3V11.37h2.58l.41-3.17H14Z"/></svg>',
    link:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10.6 13.4a1 1 0 0 1 0-1.4l2.9-2.9a1 1 0 1 1 1.4 1.4L12 13.4a1 1 0 0 1-1.4 0Zm-4.95 4.95a4.1 4.1 0 0 1 0-5.8l2.83-2.83a4.1 4.1 0 0 1 5.42-.32 1 1 0 1 1-1.18 1.62 2.1 2.1 0 0 0-2.83.11l-2.83 2.83a2.1 2.1 0 0 0 2.97 2.97l2.12-2.12a1 1 0 1 1 1.42 1.42l-2.13 2.12a4.1 4.1 0 0 1-5.79 0Zm4.45-3.75a1 1 0 0 1 1.18-1.62 2.1 2.1 0 0 0 2.83-.11l2.83-2.83a2.1 2.1 0 0 0-2.97-2.97l-2.12 2.12a1 1 0 1 1-1.42-1.42l2.13-2.12a4.1 4.1 0 0 1 5.79 5.8l-2.83 2.83a4.1 4.1 0 0 1-5.42.32Z"/></svg>'
  };
  return icons[platform] || icons.link;
}

function renderShareLinks(post, includeCopy = false) {
  const copyButton = includeCopy
    ? `<button type="button" data-copy-post="${post.id}" aria-label="Copier le lien" title="Copier le lien">${getShareIcon("link")}<span>Copier le lien</span></button>`
    : "";

  return `
    <a href="${getShareUrl("whatsapp", post)}" target="_blank" rel="noopener" aria-label="Partager sur WhatsApp" title="WhatsApp">${getShareIcon("whatsapp")}<span>WhatsApp</span></a>
    <a href="${getShareUrl("twitter", post)}" target="_blank" rel="noopener" aria-label="Partager sur Twitter/X" title="Twitter/X">${getShareIcon("twitter")}<span>Twitter/X</span></a>
    <a href="${getShareUrl("facebook", post)}" target="_blank" rel="noopener" aria-label="Partager sur Facebook" title="Facebook">${getShareIcon("facebook")}<span>Facebook</span></a>
    ${copyButton}
  `;
}

function setupBlogInteractions() {
  if (!document.querySelector("#blog-grid")) return;

  const dialog = document.createElement("div");
  dialog.className = "blog-reader hidden";
  dialog.setAttribute("role", "dialog");
  dialog.setAttribute("aria-modal", "true");
  dialog.setAttribute("aria-label", "Lecture de publication");
  dialog.innerHTML = `
    <article class="blog-reader-panel">
      <button class="dialog-close" type="button" data-blog-close aria-label="Fermer">×</button>
      <img src="" alt="" data-blog-cover />
      <div class="blog-reader-content">
        <p class="eyebrow" data-blog-category></p>
        <h2 data-blog-title></h2>
        <p class="blog-reader-meta" data-blog-meta></p>
        <p data-blog-body></p>
        <div class="blog-gallery" data-blog-gallery></div>
        <div class="share-row reader-share" data-blog-share></div>
      </div>
    </article>
  `;
  document.body.append(dialog);

  const openPost = (post) => {
    const gallery = post.gallery?.slice(0, 20) || [];
    dialog.querySelector("[data-blog-cover]").src = resolveAssetPath(post.cover || "./assets/edgard-petit.jpg");
    dialog.querySelector("[data-blog-cover]").alt = post.coverAlt || post.title;
    dialog.querySelector("[data-blog-category]").textContent = post.category;
    dialog.querySelector("[data-blog-title]").textContent = post.title;
    dialog.querySelector("[data-blog-meta]").textContent = `${post.authorName} · Relecture: ${post.auditorName}`;
    dialog.querySelector("[data-blog-body]").textContent = post.content;
    dialog.querySelector("[data-blog-gallery]").innerHTML = gallery
      .map((item) => `<img src="${resolveAssetPath(item.src)}" alt="${item.alt}" loading="lazy" />`)
      .join("");
    dialog.querySelector("[data-blog-share]").innerHTML = renderShareLinks(post, true);
    window.location.hash = post.id;
    dialog.classList.remove("hidden");
    document.body.classList.add("flyer-lightbox-open");
    dialog.querySelector("[data-blog-close]")?.focus();
  };

  const closePost = () => {
    dialog.classList.add("hidden");
    document.body.classList.remove("flyer-lightbox-open");
  };

  document.addEventListener("click", async (event) => {
    const openButton = event.target.closest("[data-post-open]");
    const shareButton = event.target.closest("[data-post-share]");
    const copyButton = event.target.closest("[data-copy-post]");

    if (openButton) {
      const post = state.content.posts.find((item) => item.id === openButton.dataset.postOpen);
      if (post) openPost(post);
    }

    if (shareButton) {
      const post = state.content.posts.find((item) => item.id === shareButton.dataset.postShare);
      if (post && navigator.share) {
        try {
          await navigator.share({ title: post.title, text: post.excerpt, url: getPostUrl(post) });
        } catch {
          return;
        }
      } else if (post) {
        await navigator.clipboard?.writeText(getPostUrl(post));
        shareButton.textContent = "Lien copié";
      }
    }

    if (copyButton) {
      const post = state.content.posts.find((item) => item.id === copyButton.dataset.copyPost);
      if (!post) return;
      await navigator.clipboard?.writeText(getPostUrl(post));
      copyButton.textContent = "Lien copié";
    }
  });

  dialog.querySelector("[data-blog-close]")?.addEventListener("click", closePost);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) closePost();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !dialog.classList.contains("hidden")) closePost();
  });

  const hashPost = state.content.posts.find((post) => `#${post.id}` === window.location.hash);
  if (hashPost) openPost(hashPost);
}

function setupAdminUploadLimits() {
  document.querySelectorAll("[data-max-files]").forEach((input) => {
    input.addEventListener("change", () => {
      const maxFiles = Number(input.dataset.maxFiles);
      if (!maxFiles || (input.files?.length || 0) <= maxFiles) return;
      input.value = "";
      const message = input.closest("label")?.querySelector("[data-upload-limit-message]");
      if (message) {
        message.textContent = `${maxFiles} photos maximum. Sélectionnez un lot plus petit.`;
      }
    });
  });
}

function getPasswordToggleIcon(isVisible) {
  if (isVisible) {
    return `
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 3l18 18" />
        <path d="M10.58 10.58a2 2 0 0 0 2.84 2.84" />
        <path d="M9.88 5.09A9.7 9.7 0 0 1 12 4.85c5.45 0 8.72 4.88 9.6 6.42.16.28.16.64 0 .92a16.7 16.7 0 0 1-2.8 3.47" />
        <path d="M6.61 6.62a16.78 16.78 0 0 0-4.21 4.65.94.94 0 0 0 0 .92c.88 1.54 4.15 6.42 9.6 6.42 1.43 0 2.72-.34 3.86-.89" />
      </svg>
    `;
  }

  return `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M2.4 11.27c.88-1.54 4.15-6.42 9.6-6.42s8.72 4.88 9.6 6.42c.16.28.16.64 0 .92-.88 1.54-4.15 6.42-9.6 6.42s-8.72-4.88-9.6-6.42a.94.94 0 0 1 0-.92Z" />
      <path d="M12 14.7a2.7 2.7 0 1 0 0-5.4 2.7 2.7 0 0 0 0 5.4Z" />
    </svg>
  `;
}

function setupPasswordToggles() {
  document.querySelectorAll('input[type="password"]').forEach((input) => {
    if (input.closest(".password-field")) return;

    const wrapper = document.createElement("span");
    wrapper.className = "password-field";
    input.parentNode.insertBefore(wrapper, input);
    wrapper.append(input);

    const button = document.createElement("button");
    button.type = "button";
    button.className = "password-toggle";
    button.setAttribute("aria-label", "Afficher le mot de passe");
    button.setAttribute("aria-pressed", "false");
    button.title = "Afficher le mot de passe";
    button.innerHTML = getPasswordToggleIcon(false);
    wrapper.append(button);

    button.addEventListener("click", () => {
      const isVisible = input.type === "text";
      input.type = isVisible ? "password" : "text";
      button.classList.toggle("is-visible", !isVisible);
      button.setAttribute("aria-label", isVisible ? "Afficher le mot de passe" : "Masquer le mot de passe");
      button.setAttribute("aria-pressed", String(!isVisible));
      button.title = isVisible ? "Afficher le mot de passe" : "Masquer le mot de passe";
      button.innerHTML = getPasswordToggleIcon(!isVisible);
    });
  });
}

function setupAdminSidebar() {
  const panel = document.querySelector(".admin-nav-panel");
  if (!panel) return;

  const navLinks = panel.querySelectorAll("nav a");
  const iconMap = {
    "Vue générale": "VG",
    "Capacité & pointage": "CP",
    Catalogue: "CA",
    Événements: "EV",
    Blog: "PU",
    Publications: "PU",
    Galerie: "GA",
    Paiements: "PA",
    Rôles: "RO",
    "Comptes & accès": "CA"
  };
  const shortLabelMap = {
    "Vue générale": "Vue",
    "Capacité & pointage": "Capacité",
    Catalogue: "Catalogue",
    Événements: "Événements",
    Blog: "Publications",
    Publications: "Publications",
    Galerie: "Galerie",
    Paiements: "Paiements",
    Rôles: "Rôles",
    "Comptes & accès": "Accès"
  };

  navLinks.forEach((link) => {
    const label = link.textContent.trim();
    link.dataset.label = label;
    link.dataset.shortLabel = shortLabelMap[label] || label;
    link.setAttribute("title", label);
    link.innerHTML = `<span class="admin-nav-icon" aria-hidden="true">${iconMap[label] || label.slice(0, 2).toUpperCase()}</span><span class="admin-nav-label" data-short-label="${link.dataset.shortLabel}">${label}</span>`;
  });

  const toggle = document.createElement("button");
  toggle.className = "admin-sidebar-toggle";
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Ouvrir le menu administration");
  toggle.setAttribute("aria-expanded", "false");
  toggle.innerHTML = `
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  `;
  panel.prepend(toggle);

  const savedState = localStorage.getItem("admin-sidebar-compact");
  const shouldCollapse = savedState === "true";

  const setCollapsed = (collapsed) => {
    document.body.classList.toggle("admin-sidebar-collapsed", collapsed);
    toggle.setAttribute("aria-expanded", String(!collapsed));
    toggle.setAttribute("aria-label", collapsed ? "Ouvrir le menu administration" : "Réduire le menu administration");
    localStorage.setItem("admin-sidebar-compact", String(collapsed));
  };

  setCollapsed(shouldCollapse);
  toggle.addEventListener("click", () => setCollapsed(!document.body.classList.contains("admin-sidebar-collapsed")));
}

function setupCustomAdminSelects() {
  document.querySelectorAll(".admin-app .dash-form select").forEach((select) => {
    if (select.dataset.customReady === "true") return;
    select.dataset.customReady = "true";

    const addValue = "__add_custom_value__";
    if (![...select.options].some((option) => option.value === addValue)) {
      select.append(new Option("+ Nouvelle valeur", addValue));
    }

    const field = document.createElement("div");
    field.className = "custom-select-field hidden";
    field.innerHTML = `
      <input type="text" autocomplete="off" />
      <button class="mini-action" type="button" data-custom-select-save>Ajouter</button>
      <button class="mini-action ghost" type="button" data-custom-select-cancel>Annuler</button>
    `;
    select.insertAdjacentElement("afterend", field);

    const input = field.querySelector("input");
    const saveButton = field.querySelector("[data-custom-select-save]");
    const cancelButton = field.querySelector("[data-custom-select-cancel]");

    const closeField = () => {
      field.classList.add("hidden");
      input.value = "";
      if (select.value === addValue) select.selectedIndex = 0;
    };

    const saveValue = () => {
      const value = input.value.trim();
      if (!value) {
        input.focus();
        return;
      }

      const existing = [...select.options].find((option) => option.textContent.trim().toLowerCase() === value.toLowerCase());
      if (existing) {
        select.value = existing.value;
      } else {
        const option = new Option(value, value, true, true);
        select.add(option, select.options[select.options.length - 1]);
      }
      closeField();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    };

    select.addEventListener("change", () => {
      if (select.value !== addValue) return;
      field.classList.remove("hidden");
      input.focus();
    });

    saveButton.addEventListener("click", saveValue);
    cancelButton.addEventListener("click", closeField);
    input.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        saveValue();
      }
      if (event.key === "Escape") closeField();
    });
  });
}

function renderEmptyRow(table, columns, message) {
  const body = table?.querySelector("tbody");
  if (!body) return;
  body.innerHTML = `<tr><td colspan="${columns}">${message}</td></tr>`;
}

function escapeHtml(value) {
  return `${value ?? ""}`.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[character]);
}

function formatAdminDate(value) {
  if (!value) return "-";
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function setAdminCard(card, strong, small) {
  if (!card) return;
  const strongElement = card.querySelector("strong");
  const smallElement = card.querySelector("small");
  if (strongElement) strongElement.textContent = strong;
  if (smallElement) smallElement.textContent = small;
}

function formatDateOnly(value) {
  if (!value) return "-";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-").map(Number);
    return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(year, month - 1, day));
  }
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(new Date(value));
}

function appointmentTypeLabel(type) {
  return {
    workspace_only: "Accès espace de travail",
    books_only: "Consultation de livre(s)",
    workspace_and_books: "Accès + livre(s)"
  }[type] || type || "-";
}

function appointmentStatusLabel(status) {
  return {
    pending: "En attente",
    confirmed: "Confirmée",
    clocked_in: "Présent",
    completed: "Terminée",
    expired: "Expirée",
    cancelled: "Annulée"
  }[status] || status || "-";
}

function paymentStatusLabel(status) {
  return {
    pending: "Paiement attendu",
    submitted: "Preuve envoyée",
    validated: "Validé",
    rejected: "Rejeté",
    cancelled: "Annulé"
  }[status] || status || "-";
}

function profileStatusLabel(status) {
  return {
    pending: "En attente",
    active: "Actif",
    suspended: "Suspendu",
    archived: "Archivé"
  }[status] || status || "-";
}

function profileStatusClass(status) {
  return status === "active" ? "success" : status === "pending" ? "warning" : "info";
}

const administrativeRoles = ["SuperAdmin", "Administrateur", "Bibliothécaire", "Modérateur", "Comptable"];
const memberTypes = [
  { value: "VISITOR", label: "Visiteur inscrit" },
  { value: "OUH", label: "Adhérent OUH" },
  { value: "ET-FMP", label: "Étudiant partenaire" },
  { value: "ET", label: "Étudiant" },
  { value: "PRO", label: "Professionnel" }
];

function isSuperAdminUser() {
  return getCurrentUser()?.roleName === "SuperAdmin" || getProfileRole(state.auth.profile) === "SuperAdmin";
}

function getMemberTypeOptions(selected = "VISITOR") {
  return memberTypes
    .map((type) => `<option value="${type.value}"${type.value === selected ? " selected" : ""}>${type.label}</option>`)
    .join("");
}

function setText(selector, value) {
  const element = document.querySelector(selector);
  if (element) element.textContent = value;
}

async function loadLibraryCapacity(client) {
  const { data, error } = await client.rpc("get_library_capacity_status").single();
  if (error) {
    console.warn("Capacité globale indisponible.", error);
    return { max_places: 20, occupied_places: 0, available_places: 20 };
  }
  return data || { max_places: 20, occupied_places: 0, available_places: 20 };
}

function updateAdherentCapacity(capacity) {
  const max = Number(capacity.max_places || 20);
  const occupied = Number(capacity.occupied_places || 0);
  const available = Number(capacity.available_places ?? Math.max(max - occupied, 0));
  const percent = max > 0 ? Math.round((occupied / max) * 100) : 0;

  setText("[data-capacity-status]", `${available} / ${max} places libres`);
  setText("[data-capacity-percent]", `${percent}%`);
  setText("[data-capacity-message]", occupied ? `${occupied} place${occupied > 1 ? "s" : ""} occupée${occupied > 1 ? "s" : ""} aujourd'hui.` : "Toutes les places sont disponibles aujourd'hui.");
  document.querySelector("[data-capacity-ring]")?.style.setProperty("--value", String(Math.min(percent, 100)));
}

function updateAdminCapacityDisplay(capacity) {
  const max = Number(capacity.max_places || 20);
  const occupied = Number(capacity.occupied_places || 0);
  const available = Number(capacity.available_places ?? Math.max(max - occupied, 0));
  const percent = max > 0 ? Math.round((occupied / max) * 100) : 0;

  document.querySelector("[data-admin-capacity-ring]")?.style.setProperty("--value", String(Math.min(percent, 100)));
  setText("[data-admin-capacity-ring-label]", `${occupied}/${max}`);
  setText("[data-admin-capacity-status]", `${occupied} présent${occupied > 1 ? "s" : ""}`);
  setText("[data-admin-capacity-available]", String(available));
  setText("[data-admin-capacity-occupied]", String(occupied));

  const input = document.querySelector("[data-capacity-max-input]");
  if (input && document.activeElement !== input) input.value = String(max);
}

function updateAdherentProfile(profile, user, appointments, registrations) {
  const displayName = profile?.full_name || user?.name || "Adhérent";
  const memberCode = profile?.member_code || "Code en attente";
  const memberType = profile?.member_type || "Adhérent";
  const status = profile?.status === "active" ? "Compte actif" : `Compte ${profile?.status || "en attente"}`;
  const paidRegistrations = registrations.filter((registration) => ["submitted", "validated"].includes(registration.status));

  setText("[data-member-name]", `Bonjour ${displayName}`);
  setText("[data-member-summary]", `${memberType} · ${memberCode}`);
  setText("[data-member-status]", status);
  setText("[data-member-reservations]", `${appointments.length} réservation${appointments.length > 1 ? "s" : ""}`);
  setText("[data-member-payments]", `${paidRegistrations.length} paiement${paidRegistrations.length > 1 ? "s" : ""} suivi${paidRegistrations.length > 1 ? "s" : ""}`);

  const codeInput = document.querySelector("[data-member-code]");
  if (codeInput && profile?.member_code) codeInput.value = profile.member_code;
}

function updateAdherentStats(appointments, registrations) {
  const now = new Date();
  const upcomingAppointments = appointments
    .filter((appointment) => new Date(`${appointment.reservation_date}T${appointment.start_time || "00:00"}`) >= now)
    .sort((first, second) => new Date(`${first.reservation_date}T${first.start_time}`) - new Date(`${second.reservation_date}T${second.start_time}`));
  const latestPayment = [...registrations].sort((first, second) => new Date(second.created_at) - new Date(first.created_at))[0];
  const validatedRegistrations = registrations.filter((registration) => registration.status === "validated");

  if (upcomingAppointments[0]) {
    const next = upcomingAppointments[0];
    setText("[data-next-appointment]", formatDateOnly(next.reservation_date));
    setText("[data-next-appointment-detail]", `${next.start_time || "-"} · ${appointmentStatusLabel(next.status)}`);
  }

  if (latestPayment) {
    setText("[data-payment-status]", paymentStatusLabel(latestPayment.status));
    setText("[data-payment-detail]", latestPayment.events?.title || "Événement");
  }

  setText("[data-participations]", String(validatedRegistrations.length));
  setText("[data-participations-detail]", validatedRegistrations.length ? "Participation validée" : "Aucune participation validée");
}

function renderAdherentHistory(appointments, registrations) {
  const body = document.querySelector("[data-adherent-history]");
  if (!body) return;

  const appointmentRows = appointments.map((appointment) => ({
    date: appointment.reservation_date,
    type: "Réservation",
    detail: `${appointmentTypeLabel(appointment.type)} · ${appointment.start_time || "-"}`,
    status: appointmentStatusLabel(appointment.status)
  }));
  const registrationRows = registrations.map((registration) => ({
    date: registration.created_at,
    type: "Événement",
    detail: registration.events?.title || "Événement",
    status: paymentStatusLabel(registration.status)
  }));
  const rows = [...appointmentRows, ...registrationRows].sort((first, second) => new Date(second.date) - new Date(first.date));

  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="4">Aucune activité enregistrée.</td></tr>`;
    return;
  }

  body.innerHTML = rows
    .map((row) => `<tr><td>${formatDateOnly(row.date)}</td><td>${escapeHtml(row.type)}</td><td>${escapeHtml(row.detail)}</td><td><span class="status-pill info">${escapeHtml(row.status)}</span></td></tr>`)
    .join("");
}

function getMemberDiscount(profile) {
  return calculateDiscount(profile?.member_code || profile?.member_type || "");
}

function getPayableEvents() {
  return getPublishedEvents().filter((event) => event.paymentRequired || event.basePrice > 0);
}

function updateEventPaymentPreview(event, profile) {
  const basePrice = Number(event?.basePrice || 0);
  const discount = getMemberDiscount(profile);
  const finalPrice = Math.max(basePrice * (1 - discount / 100), 0);
  const baseInput = document.querySelector("[data-event-base-price]");
  const finalInput = document.querySelector("[data-event-final-price]");
  if (baseInput) baseInput.value = event ? formatCurrency(basePrice) : "-";
  if (finalInput) finalInput.value = event ? `${formatCurrency(finalPrice)}${discount ? ` (${discount}%)` : ""}` : "-";
  return { discount, finalPrice };
}

function setupAdherentEventForm(client, profile) {
  const form = document.querySelector("[data-event-payment-form]");
  const select = document.querySelector("[data-member-event-select]");
  if (!form || !select) return;

  const events = getPayableEvents();
  select.innerHTML = events.length
    ? events.map((event) => `<option value="${escapeHtml(event.id)}">${escapeHtml(event.title)}</option>`).join("")
    : `<option value="">Aucun événement disponible</option>`;

  const refreshPreview = () => {
    const event = events.find((item) => item.id === select.value);
    updateEventPaymentPreview(event, profile);
  };

  refreshPreview();
  select.addEventListener("change", refreshPreview);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector("[data-event-payment-message]");
    const submit = form.querySelector('button[type="submit"]');
    const selectedEvent = events.find((item) => item.id === select.value);
    const file = form.querySelector("[data-payment-proof]")?.files?.[0];

    if (!selectedEvent) {
      showAuthMessage(message, "Aucun événement payant sélectionné.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Envoi...";

    const { discount, finalPrice } = updateEventPaymentPreview(selectedEvent, profile);
    const { data: registration, error: registrationError } = await client
      .from("event_registrations")
      .upsert({
        event_id: selectedEvent.id,
        user_id: state.auth.session.user.id,
        discount_applied: discount,
        final_price: finalPrice,
        status: "pending"
      }, { onConflict: "event_id,user_id" })
      .select("id")
      .single();

    if (registrationError) {
      showAuthMessage(message, "Inscription impossible pour le moment.", "error");
      console.warn("Inscription événement impossible.", registrationError);
      submit.disabled = false;
      submit.textContent = "Envoyer la preuve";
      return;
    }

    if (file) {
      const extension = file.name.split(".").pop() || "file";
      const storagePath = `${state.auth.session.user.id}/${registration.id}-${Date.now()}.${extension}`;
      const { error: uploadError } = await client.storage.from("payment-proofs").upload(storagePath, file, { upsert: true });
      if (uploadError) {
        showAuthMessage(message, "Inscription créée, mais la preuve n'a pas été envoyée.", "error");
        console.warn("Upload preuve paiement impossible.", uploadError);
        submit.disabled = false;
        submit.textContent = "Envoyer la preuve";
        return;
      }
      const { error: proofError } = await client.rpc("submit_payment_proof", { registration_id: registration.id, proof_url: storagePath });
      if (proofError) {
        showAuthMessage(message, "Preuve envoyée, validation en attente de synchronisation.", "error");
        console.warn("Enregistrement preuve paiement impossible.", proofError);
        submit.disabled = false;
        submit.textContent = "Envoyer la preuve";
        return;
      }
    }

    showAuthMessage(message, file ? "Preuve envoyée. Validation en attente." : "Inscription enregistrée.");
    submit.disabled = false;
    submit.textContent = "Envoyer la preuve";
  });
}

function setupAdherentAppointmentForm(client) {
  const form = document.querySelector("[data-appointment-form]");
  if (!form) return;

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector("[data-appointment-message]");
    const submit = form.querySelector('button[type="submit"]');
    const reservationDate = form.querySelector("[data-appointment-date]")?.value;
    const startTime = form.querySelector("[data-appointment-start]")?.value;

    if (!reservationDate || !startTime) {
      showAuthMessage(message, "Choisissez une date et une heure.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Envoi...";

    const { error } = await client.from("appointments").insert({
      user_id: state.auth.session.user.id,
      type: form.querySelector("[data-appointment-type]")?.value || "workspace_and_books",
      reservation_date: reservationDate,
      start_time: startTime,
      duration_hours: Number(form.querySelector("[data-appointment-duration]")?.value || 2)
    });

    if (error) {
      showAuthMessage(message, "Demande impossible pour le moment.", "error");
      console.warn("Création réservation impossible.", error);
      submit.disabled = false;
      submit.textContent = "Demander la réservation";
      return;
    }

    showAuthMessage(message, "Demande de réservation enregistrée.");
    form.reset();
    submit.disabled = false;
    submit.textContent = "Demander la réservation";
  });
}

async function hydrateAdherentSpace() {
  if (document.body.dataset.page !== "adherent") return;
  const client = await getSupabaseClient();
  if (!client || !state.auth.session?.user) return;

  const profile = state.auth.profile || {};
  const user = state.auth.user || {};
  const userId = state.auth.session.user.id;

  const [capacity, appointmentsResponse, registrationsResponse] = await Promise.all([
    loadLibraryCapacity(client),
    client.from("appointments").select("*").eq("user_id", userId).order("reservation_date", { ascending: false }).order("start_time", { ascending: false }).limit(50),
    client.from("event_registrations").select("*, events(title,event_date)").eq("user_id", userId).order("created_at", { ascending: false }).limit(50)
  ]);

  const appointments = appointmentsResponse.error ? [] : appointmentsResponse.data || [];
  const registrations = registrationsResponse.error ? [] : registrationsResponse.data || [];
  if (appointmentsResponse.error) console.warn("Réservations adhérent illisibles.", appointmentsResponse.error);
  if (registrationsResponse.error) console.warn("Inscriptions adhérent illisibles.", registrationsResponse.error);

  updateAdherentCapacity(capacity);
  updateAdherentProfile(profile, user, appointments, registrations);
  updateAdherentStats(appointments, registrations);
  renderAdherentHistory(appointments, registrations);
  setupAdherentAppointmentForm(client);
  setupAdherentEventForm(client, profile);
}

async function selectAdminRows(client, table, queryBuilder) {
  const response = await queryBuilder(client.from(table));
  if (response.error) {
    console.warn(`Lecture Supabase impossible: ${table}`, response.error);
    return [];
  }
  return response.data || [];
}

async function countAdminRows(client, table, queryBuilder = (query) => query) {
  const response = await queryBuilder(client.from(table)).select("id", { count: "exact", head: true });
  if (response.error) {
    console.warn(`Comptage Supabase impossible: ${table}`, response.error);
    return 0;
  }
  return response.count || 0;
}

async function countCatalogBooks(client) {
  const { data, error } = await client.rpc("count_catalog_books");
  if (!error && Number.isFinite(Number(data))) return Number(data);
  if (error) console.warn("Compteur catalogue SQL indisponible, fallback count exact.", error);
  return countAdminRows(client, "books");
}

async function renderAdminOverview(client) {
  const [booksCount, eventsCount, postsCount, photosCount, payments, appointments, capacity] = await Promise.all([
    countCatalogBooks(client),
    countAdminRows(client, "events"),
    countAdminRows(client, "blog_posts"),
    countAdminRows(client, "gallery_photos"),
    selectAdminRows(client, "event_registrations", (query) => query.select("id,status").in("status", ["pending", "submitted"]).limit(1000)),
    selectAdminRows(client, "appointments", (query) => query.select("id,status").in("status", ["confirmed", "clocked_in"]).limit(1000)),
    loadLibraryCapacity(client)
  ]);

  const cards = document.querySelectorAll(".admin-kpi-card");
  const presentCount = appointments.length;
  const maxPlaces = Number(capacity.max_places || 20);
  const availableSeats = Number(capacity.available_places ?? Math.max(maxPlaces - presentCount, 0));
  setAdminCard(cards[0], `${presentCount} / ${maxPlaces}`, `${availableSeats} places disponibles`);
  cards[0]?.querySelector(".kpi-meter span")?.style.setProperty("width", `${Math.min((presentCount / maxPlaces) * 100, 100)}%`);
  setAdminCard(cards[1], String(payments.length), "preuves à valider");
  setAdminCard(cards[2], String(booksCount), "livres dans le catalogue");
  setAdminCard(cards[3], "0", "aucune relance planifiée");

  const timeline = document.querySelector(".admin-timeline");
  if (timeline) {
    timeline.innerHTML = `<article><strong>Base</strong><span>${booksCount} livres, ${eventsCount} événements, ${postsCount} publications, ${photosCount} photos.</span></article>`;
  }
}

async function renderAdminCatalogue(client) {
  let booksResponse = await client.from("books").select("*, book_details(*)").order("title", { ascending: true }).limit(10000);
  if (booksResponse.error) {
    console.warn("Lecture des fiches liées indisponible, lecture simple du catalogue.", booksResponse.error);
    booksResponse = await client.from("books").select("*").order("title", { ascending: true }).limit(10000);
  }
  if (booksResponse.error) {
    console.warn("Lecture Supabase impossible: books", booksResponse.error);
  }
  const booksCount = await countCatalogBooks(client);
  const books = booksResponse.data || [];
  state.adminCatalogBooks = sortBooksAlphabetically(books.map(mapBook));
  setText("[data-catalog-count]", getBookCountLabel(booksCount || state.adminCatalogBooks.length));
  await renderCatalogArchives(client);
  setupCatalogImport(client);
  setupAdminCatalogFilters();
  renderAdminCatalogTable();
}

function setupAdminCatalogFilters() {
  const form = document.querySelector("[data-admin-catalog-filters]");
  if (!form) return;
  const categorySelect = form.querySelector("[data-admin-category-filter]");
  const selectedCategory = categorySelect?.value || "";
  const categories = [...new Set(state.adminCatalogBooks.map((book) => book.category).filter(Boolean))].sort();
  renderOptions(categorySelect, categories);
  if (categorySelect && categories.includes(selectedCategory)) categorySelect.value = selectedCategory;
  if (form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  const updateTable = () => {
    state.adminCatalogPage = 1;
    renderAdminCatalogTable();
  };
  form.addEventListener("input", updateTable);
  form.addEventListener("change", updateTable);
}

function getFilteredAdminCatalogBooks() {
  const query = document.querySelector("[data-admin-book-search]")?.value.trim().toLowerCase() || "";
  const category = document.querySelector("[data-admin-category-filter]")?.value || "";

  return sortBooksAlphabetically(
    state.adminCatalogBooks.filter((book) => {
      const haystack = `${book.title} ${book.category}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!category || book.category === category);
    })
  );
}

function renderAdminCatalogTable() {
  const table = document.querySelector("[data-admin-catalog-table]");
  const filteredBooks = getFilteredAdminCatalogBooks();
  const pageInfo = getPaginatedItems(filteredBooks, state.adminCatalogPage);
  state.adminCatalogPage = pageInfo.page;
  renderCatalogTable(table, pageInfo.items);
  renderPagination(document.querySelector("[data-admin-catalog-pagination]"), pageInfo, (page) => {
    state.adminCatalogPage = page;
    renderAdminCatalogTable();
  });
}

function normalizeColumnName(value) {
  return `${value || ""}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function findCatalogColumn(headers, aliases) {
  const normalizedAliases = aliases.map(normalizeColumnName);
  return headers.findIndex((header) => normalizedAliases.includes(normalizeColumnName(header)));
}

function getCatalogHeaderMap(rows) {
  const aliases = {
    number: ["numero", "no", "num", "id"],
    location: ["emplacement", "cote", "code", "localisation"],
    category: ["categorie/sujet", "categoriesujet", "categorie", "sujet"],
    title: ["titre du livre", "titredulivre", "titre", "livre"],
    author: ["auteur", "author"],
    edition: ["edition", "collection"],
    language: ["langue", "language"],
    ownership: ["propriete", "propriété", "ownership"]
  };

  for (let rowIndex = 0; rowIndex < Math.min(rows.length, 30); rowIndex += 1) {
    const headers = rows[rowIndex] || [];
    const map = Object.fromEntries(Object.entries(aliases).map(([key, values]) => [key, findCatalogColumn(headers, values)]));
    if (map.location >= 0 && map.title >= 0) {
      if (map.number < 0 && !headers[0]) map.number = 0;
      return { rowIndex, map };
    }
  }

  return null;
}

function parseCatalogWorkbook(file) {
  return new Promise((resolve, reject) => {
    const xlsx = window.XLSX;
    if (!xlsx) {
      reject(new Error("xlsx_library_missing"));
      return;
    }

    const reader = new FileReader();
    reader.onerror = () => reject(new Error("file_read_error"));
    reader.onload = () => {
      try {
        const workbook = xlsx.read(new Uint8Array(reader.result), { type: "array" });
        const sheetName = workbook.SheetNames.includes("Liste des Livres") ? "Liste des Livres" : workbook.SheetNames[0];
        const rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: "" });
        const header = getCatalogHeaderMap(rows);
        if (!header) throw new Error("catalog_headers_missing");

        const books = rows.slice(header.rowIndex + 1)
          .map((row) => ({
            number: `${row[header.map.number] || ""}`.trim(),
            location: `${row[header.map.location] || ""}`.trim(),
            category: `${row[header.map.category] || "Catalogue"}`.trim(),
            title: `${row[header.map.title] || ""}`.trim(),
            author: `${row[header.map.author] || ""}`.trim(),
            edition: `${row[header.map.edition] || ""}`.trim(),
            language: `${row[header.map.language] || ""}`.trim(),
            ownership: `${row[header.map.ownership] || ""}`.trim()
          }))
          .filter((book) => book.location && book.title);

        resolve(books);
      } catch (error) {
        reject(error);
      }
    };
    reader.readAsArrayBuffer(file);
  });
}

function chunkRows(rows, size = 400) {
  const chunks = [];
  for (let index = 0; index < rows.length; index += size) {
    chunks.push(rows.slice(index, index + size));
  }
  return chunks;
}

async function uploadCatalogArchive(client, file) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = file.name.replace(/[^\w.-]+/g, "_");
  const storagePath = `${new Date().getFullYear()}/${timestamp}-${safeName}`;
  const { error: uploadError } = await client.storage.from("excel-archives").upload(storagePath, file, { upsert: false });
  if (uploadError) throw uploadError;

  const { error: archiveError } = await client.from("excel_archives").insert({
    file_name: file.name,
    storage_path: storagePath,
    uploaded_by: state.auth.profile?.id || state.auth.session?.user?.id || null
  });
  if (archiveError) throw archiveError;
}

function getCatalogImportErrorMessage(error, step = "") {
  const message = `${error?.message || ""}`;
  const details = `${error?.details || ""}`;
  const hint = `${error?.hint || ""}`;
  const code = `${error?.code || ""}`;
  const raw = `${message} ${details} ${hint} ${code}`.toLowerCase();
  const stepLabel = step === "archive"
    ? " pendant l'archivage Excel"
    : step === "books"
      ? " pendant la synchronisation du catalogue"
      : "";

  if (message === "catalog_headers_missing") return "Colonnes obligatoires introuvables: Emplacement et TITRE DU LIVRE.";
  if (message === "xlsx_library_missing") return "Lecteur Excel indisponible. Vérifiez la connexion au CDN XLSX.";
  if (message === "file_read_error") return "Le navigateur n'arrive pas à lire ce fichier Excel.";
  if (message === "empty_catalog") return "Aucun livre valide trouvé. Le fichier doit contenir au moins Emplacement et TITRE DU LIVRE.";
  if (raw.includes("bucket not found") || raw.includes("not found")) return "Bucket Supabase introuvable. Vérifiez que le bucket excel-archives existe.";
  if (raw.includes("row-level security") || raw.includes("rls") || raw.includes("violates row-level security")) return `Permission Supabase refusée${stepLabel}. Vérifiez que le compte connecté a le rôle SuperAdmin ou Bibliothécaire avec books.import.excel.`;
  if (raw.includes("permission denied") || raw.includes("unauthorized") || raw.includes("not authorized") || raw.includes("403")) return `Accès refusé par Supabase${stepLabel}. Vérifiez les politiques Storage et RLS du catalogue.`;
  if (raw.includes("duplicate") || code === "23505") return "Conflit de données dans Supabase. Une valeur unique existe déjà dans le catalogue ou l'archive.";
  if (raw.includes("network") || raw.includes("failed to fetch")) return "Connexion Supabase impossible. Vérifiez Internet et la configuration Supabase.";
  if (raw.includes("excel_archives")) return "L'archive Excel n'a pas pu être enregistrée dans la table excel_archives.";
  if (raw.includes("books")) return "Le catalogue n'a pas pu être synchronisé dans la table books.";

  return message ? `Import impossible: ${message}` : "Import impossible pour le moment.";
}

async function syncCatalogBooks(client, books, removeMissing) {
  const { data, error } = await client.rpc("sync_catalog_import", { import_books: books });
  if (!error) return data || books.length;

  const raw = `${error?.message || ""} ${error?.code || ""}`.toLowerCase();
  if (!raw.includes("could not find the function") && !raw.includes("pgrst202") && !raw.includes("schema cache")) {
    throw error;
  }

  for (const chunk of chunkRows(books)) {
    const { error } = await client.from("books").upsert(chunk, { onConflict: "location" });
    if (error) throw error;
  }

  if (!removeMissing) return books.length;
  const uploadedLocations = new Set(books.map((book) => book.location));
  const existing = await selectAdminRows(client, "books", (query) => query.select("location").limit(10000));
  const missingLocations = existing.map((book) => book.location).filter((location) => location && !uploadedLocations.has(location));

  for (const chunk of chunkRows(missingLocations, 250)) {
    const { error } = await client.from("books").delete().in("location", chunk);
    if (error) throw error;
  }

  return books.length;
}

async function renderCatalogArchives(client) {
  const table = document.querySelector("[data-catalog-archives-table]");
  if (!table) return;
  const archives = await selectAdminRows(client, "excel_archives", (query) => query.select("*").order("uploaded_at", { ascending: false }).limit(25));

  if (!archives.length) {
    renderEmptyRow(table, 3, "Aucune archive disponible.");
    return;
  }

  const rows = await Promise.all(archives.map(async (archive) => {
    const { data, error } = await client.storage.from("excel-archives").createSignedUrl(archive.storage_path, 3600);
    const href = error ? "" : data?.signedUrl || "";
    const action = href ? `<a class="mini-action" href="${escapeHtml(href)}" target="_blank" rel="noopener">Télécharger</a>` : "-";
    return `<tr><td>${formatAdminDate(archive.uploaded_at)}</td><td>${escapeHtml(archive.file_name)}</td><td>${action}</td></tr>`;
  }));

  table.querySelector("tbody").innerHTML = rows.join("");
}

function setupCatalogImport(client) {
  const form = document.querySelector("[data-catalog-import-form]");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  const fileInput = form.querySelector("[data-catalog-file]");
  const fileName = form.querySelector("[data-catalog-file-name]");

  const runImport = async () => {
    const file = fileInput?.files?.[0];
    const message = form.querySelector("[data-catalog-import-message]");
    const submit = form.querySelector(".catalogue-upload-button");
    if (!file) {
      showAuthMessage(message, "Choisissez un fichier Excel.", "error");
      return;
    }

    if (fileName) fileName.textContent = file.name;
    submit?.classList.add("is-loading");
    if (submit) submit.textContent = "Téléversement en cours...";

    let importStep = "lecture";
    try {
      const books = await parseCatalogWorkbook(file);
      if (!books.length) throw new Error("empty_catalog");
      importStep = "archive";
      await uploadCatalogArchive(client, file);
      importStep = "books";
      const syncedCount = await syncCatalogBooks(client, books, true);
      showAuthMessage(message, `${syncedCount} livre${syncedCount > 1 ? "s" : ""} synchronisé${syncedCount > 1 ? "s" : ""}.`);
      form.reset();
      if (fileName) fileName.textContent = "Fichier téléversé et synchronisé.";
      submit?.classList.remove("is-loading");
      if (submit) submit.textContent = "Téléverser le fichier Excel sur Supabase";
      await renderAdminCatalogue(client);
    } catch (error) {
      console.warn("Import catalogue impossible.", error);
      showAuthMessage(message, getCatalogImportErrorMessage(error, importStep), "error");
      submit?.classList.remove("is-loading");
      if (submit) submit.textContent = "Téléverser le fichier Excel sur Supabase";
    }
  };

  fileInput?.addEventListener("change", runImport);
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    runImport();
  });
}

async function renderAdminEvents(client) {
  const table = document.querySelector(".admin-overview-panel table");
  const events = await selectAdminRows(client, "events", (query) => query.select("*").order("event_date", { ascending: false }).limit(50));
  if (!events.length) {
    renderEmptyRow(table, 5, "Aucun événement enregistré.");
    return;
  }

  table.querySelector("tbody").innerHTML = events
    .map((event) => `<tr><td>${escapeHtml(event.title || "-")}</td><td>${formatAdminDate(event.event_date)}</td><td><span class="status-pill info">${escapeHtml(event.status || "-")}</span></td><td>${escapeHtml(event.capacity || "-")}</td><td>${event.visibility === "public" ? "Oui" : "Non"}</td></tr>`)
    .join("");
}

async function renderAdminBlog(client) {
  const table = document.querySelector(".admin-overview-panel table");
  const posts = await selectAdminRows(client, "blog_posts", (query) => query.select("*, blog_post_photos(id)").order("created_at", { ascending: false }).limit(50));
  if (!posts.length) {
    renderEmptyRow(table, 4, "Aucune publication enregistrée.");
    return;
  }

  table.querySelector("tbody").innerHTML = posts
    .map((post) => `<tr><td>${escapeHtml(post.title || "-")}</td><td>${escapeHtml(post.author_name || "-")}</td><td><span class="status-pill info">${escapeHtml(post.status || "-")}</span></td><td>${post.blog_post_photos?.length || 0} photo(s)</td></tr>`)
    .join("");
}

async function renderAdminGallery(client) {
  const table = document.querySelector(".admin-overview-panel table");
  const photos = await selectAdminRows(client, "gallery_photos", (query) => query.select("*").order("created_at", { ascending: false }).limit(50));
  if (!photos.length) {
    renderEmptyRow(table, 4, "Aucune photo enregistrée.");
    return;
  }

  table.querySelector("tbody").innerHTML = photos
    .map((photo) => `<tr><td>${escapeHtml(photo.storage_path || "-")}</td><td><input value="${escapeHtml(photo.title || "")}" /></td><td>${escapeHtml(photo.album || "-")}</td><td><span class="status-pill info">${escapeHtml(photo.status || "-")}</span></td></tr>`)
    .join("");
}

async function renderAdminPayments(client) {
  const table = document.querySelector("[data-admin-payments-table]");
  const payments = await selectAdminRows(client, "event_registrations", (query) =>
    query.select("*, events(title), profiles(full_name,email,member_code)").in("status", ["pending", "submitted"]).order("created_at", { ascending: false }).limit(50)
  );
  setText("[data-payments-count]", `${payments.length} en attente`);
  if (!payments.length) {
    renderEmptyRow(table, 6, "Aucune preuve de paiement à traiter.");
    return;
  }

  const rows = await Promise.all(payments.map(async (payment) => {
      const profile = payment.profiles || {};
      const member = profile.member_code || profile.email || profile.full_name || "-";
      const eventTitle = payment.events?.title || "-";
      let proofUrl = payment.payment_proof_url || "";
      if (proofUrl && !/^https?:\/\//.test(proofUrl)) {
        const { data, error } = await client.storage.from("payment-proofs").createSignedUrl(proofUrl, 3600);
        if (!error) proofUrl = data?.signedUrl || proofUrl;
      }
      const proof = proofUrl ? `<a class="mini-action" href="${escapeHtml(proofUrl)}" target="_blank" rel="noopener">Ouvrir</a>` : "-";
      return `
        <tr data-payment-row="${escapeHtml(payment.id)}">
          <td>${escapeHtml(member)}</td>
          <td>${escapeHtml(eventTitle)}</td>
          <td>${formatCurrency(payment.final_price || 0)}</td>
          <td>${proof}</td>
          <td><span class="status-pill ${payment.status === "submitted" ? "warning" : "info"}">${paymentStatusLabel(payment.status)}</span></td>
          <td>
            <button class="mini-action" type="button" data-payment-action="validated">Valider</button>
            <button class="mini-action danger" type="button" data-payment-action="rejected">Rejeter</button>
          </td>
        </tr>
      `;
    }));

  table.querySelector("tbody").innerHTML = rows.join("");
  setupAdminPaymentActions(client);
}

function setupAdminPaymentActions(client) {
  document.querySelectorAll("[data-payment-action]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const row = button.closest("[data-payment-row]");
      if (!row) return;

      const originalText = button.textContent;
      const status = button.dataset.paymentAction;
      button.disabled = true;
      button.textContent = "Traitement...";

      const { error } = await client
        .from("event_registrations")
        .update({ status })
        .eq("id", row.dataset.paymentRow);

      if (error) {
        console.warn("Validation paiement impossible.", error);
        button.textContent = "Erreur";
        setTimeout(() => {
          button.disabled = false;
          button.textContent = originalText;
        }, 1200);
        return;
      }

      button.textContent = "Fait";
      await renderAdminPayments(client);
    });
  });
}

async function renderAdminRoles(client) {
  const table = document.querySelector("[data-admin-users-table]");
  const roles = await selectAdminRows(client, "roles_permissions", (query) => query.select("id,role_name,permissions_json").order("role_name", { ascending: true }));
  const users = await selectAdminRows(client, "profiles", (query) => query.select("id,full_name,email,status,member_code,member_type,role_id,roles_permissions(role_name)").order("created_at", { ascending: false }).limit(200));
  const canManageAdministrativeAccounts = isSuperAdminUser();

  const roleOptions = [
    `<option value="">Aucun rôle admin</option>`,
    ...roles.map((role) => {
      const disabled = administrativeRoles.includes(role.role_name) && !canManageAdministrativeAccounts ? " disabled" : "";
      const label = administrativeRoles.includes(role.role_name) ? `${role.role_name} · administration` : role.role_name;
      return `<option value="${escapeHtml(role.role_name)}"${disabled}>${escapeHtml(label)}</option>`;
    })
  ].filter(Boolean).join("");
  const createRoleSelect = document.querySelector("[data-admin-profile-role]");
  if (createRoleSelect) createRoleSelect.innerHTML = roleOptions;
  const createTypeSelect = document.querySelector("[data-admin-profile-type]");
  if (createTypeSelect) createTypeSelect.innerHTML = getMemberTypeOptions(createTypeSelect.value || "VISITOR");

  const superAdmin = roles.find((role) => role.role_name === "SuperAdmin");
  const permissionsGrid = document.querySelector("[data-superadmin-permissions]");
  if (permissionsGrid) {
    const permissions = superAdmin?.permissions_json || [];
    permissionsGrid.innerHTML = permissions.length
      ? permissions.map((permission) => `<label><input type="checkbox" checked disabled /> ${escapeHtml(permission)}</label>`).join("")
      : `<label><input type="checkbox" disabled /> Aucune permission chargée</label>`;
  }

  setText("[data-users-count]", `${users.length} compte${users.length > 1 ? "s" : ""}`);
  if (!users.length) {
    renderEmptyRow(table, 6, "Aucun utilisateur chargé.");
    setupAdminProfileCreation(client);
    return;
  }

  table.querySelector("tbody").innerHTML = users
    .map((user) => {
      const selectedRole = user.roles_permissions?.role_name || "";
      const rowRoleOptions = roleOptions.replace(`value="${escapeHtml(selectedRole)}"`, `value="${escapeHtml(selectedRole)}" selected`);
      return `
        <tr data-admin-user-row="${escapeHtml(user.id)}">
          <td>
            <strong>${escapeHtml(user.full_name || "-")}</strong>
            <small>${escapeHtml(user.email || "-")}</small>
          </td>
          <td><input value="${escapeHtml(user.member_code || "")}" data-user-code /></td>
          <td><select data-user-type>${getMemberTypeOptions(user.member_type || "VISITOR")}</select></td>
          <td><select data-user-role>${rowRoleOptions}</select></td>
          <td>
            <select data-user-status>
              <option value="pending"${user.status === "pending" ? " selected" : ""}>En attente</option>
              <option value="active"${user.status === "active" ? " selected" : ""}>Actif</option>
              <option value="suspended"${user.status === "suspended" ? " selected" : ""}>Suspendu</option>
              <option value="archived"${user.status === "archived" ? " selected" : ""}>Archivé</option>
            </select>
            <span class="status-pill ${profileStatusClass(user.status)}">${profileStatusLabel(user.status)}</span>
          </td>
          <td>
            <input value="${escapeHtml(user.full_name || "")}" data-user-name aria-label="Nom complet" />
            <button class="mini-action" type="button" data-save-user-access>Appliquer</button>
          </td>
        </tr>
      `;
    })
    .join("");

  setupAdminProfileCreation(client);
  setupAdminAccessUpdates(client);
}

function getAdminRpcMessage(error) {
  const message = `${error?.message || ""}`;
  if (message.includes("non-2xx") || message.includes("Functions")) return "Fonction de création non déployée ou refusée par Supabase.";
  if (message.includes("auth_user_not_found")) return "Compte Auth introuvable. Créez d'abord l'utilisateur dans Supabase Auth.";
  if (message.includes("superadmin_required_for_admin_accounts")) return "Seul le SuperAdmin peut attribuer un rôle d'administration.";
  if (message.includes("permission_denied")) return "Permission refusée pour ce compte.";
  if (message.includes("profile_not_found")) return "Profil introuvable.";
  if (message.includes("duplicate key") || message.toLowerCase().includes("already")) return "Code adhérent ou email déjà utilisé.";
  return "Action impossible pour le moment.";
}

function setupAdminProfileCreation(client) {
  const form = document.querySelector("[data-admin-create-profile-form]");
  if (!form || form.dataset.bound === "true") return;
  form.dataset.bound = "true";
  const accountFamily = form.querySelector("[data-admin-account-family]");
  const roleSelect = form.querySelector("[data-admin-profile-role]");
  const typeSelect = form.querySelector("[data-admin-profile-type]");
  const adminFamilyOption = accountFamily?.querySelector('option[value="admin"]');
  if (adminFamilyOption && !isSuperAdminUser()) adminFamilyOption.disabled = true;

  const syncAccountFamily = () => {
    const isAdministrativeAccount = accountFamily?.value === "admin";
    if (isAdministrativeAccount && !isSuperAdminUser()) {
      accountFamily.value = "member";
      showAuthMessage(form.querySelector("[data-admin-create-profile-message]"), "Seul le SuperAdmin peut créer un compte d'administration.", "error");
      return;
    }
    if (typeSelect) {
      typeSelect.value = isAdministrativeAccount ? "OUH" : typeSelect.value || "VISITOR";
      typeSelect.disabled = isAdministrativeAccount;
    }
    if (roleSelect) {
      roleSelect.required = isAdministrativeAccount;
      if (!isAdministrativeAccount) roleSelect.value = roleSelect.querySelector('option[value="Adhérent"]') ? "Adhérent" : "";
    }
  };

  syncAccountFamily();
  accountFamily?.addEventListener("change", syncAccountFamily);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const message = form.querySelector("[data-admin-create-profile-message]");
    const submit = form.querySelector('button[type="submit"]');
    submit.disabled = true;
    submit.textContent = "Création...";
    const password = form.querySelector("[data-admin-profile-password]")?.value || "";
    const selectedFamily = accountFamily?.value || "member";
    const selectedRole = roleSelect?.value || null;

    if (selectedFamily === "admin" && !selectedRole) {
      showAuthMessage(message, "Choisissez un rôle d'administration.", "error");
      submit.disabled = false;
      submit.textContent = "Créer / activer";
      return;
    }

    const payload = {
      email: form.querySelector("[data-admin-profile-email]")?.value.trim(),
      fullName: form.querySelector("[data-admin-profile-name]")?.value.trim(),
      memberCode: form.querySelector("[data-admin-profile-code]")?.value.trim() || null,
      memberType: selectedFamily === "admin" ? "OUH" : typeSelect?.value || "VISITOR",
      roleName: selectedFamily === "admin" ? selectedRole : selectedRole === "Adhérent" ? "Adhérent" : null,
      status: form.querySelector("[data-admin-profile-status]")?.value || "active"
    };

    const { error } = password
      ? await client.functions.invoke("admin-create-user", { body: { ...payload, password } })
      : await client.rpc("admin_create_profile_for_auth_user", {
          target_email: payload.email,
          target_full_name: payload.fullName,
          target_member_code: payload.memberCode,
          target_member_type: payload.memberType,
          target_role_name: payload.roleName,
          target_status: payload.status
        });

    if (error) {
      showAuthMessage(message, getAdminRpcMessage(error), "error");
      console.warn("Création profil admin impossible.", error);
      submit.disabled = false;
      submit.textContent = "Créer / activer";
      return;
    }

    showAuthMessage(message, "Compte créé / activé.");
    form.reset();
    syncAccountFamily();
    submit.disabled = false;
    submit.textContent = "Créer / activer";
    await renderAdminRoles(client);
  });
}

function setupAdminAccessUpdates(client) {
  document.querySelectorAll("[data-save-user-access]").forEach((button) => {
    if (button.dataset.bound === "true") return;
    button.dataset.bound = "true";
    button.addEventListener("click", async () => {
      const row = button.closest("[data-admin-user-row]");
      if (!row) return;

      const originalText = button.textContent;
      button.disabled = true;
      button.textContent = "En cours...";

      const { error } = await client.rpc("admin_update_profile_access", {
        target_profile_id: row.dataset.adminUserRow,
        target_full_name: row.querySelector("[data-user-name]")?.value.trim(),
        target_member_code: row.querySelector("[data-user-code]")?.value.trim() || null,
        target_member_type: row.querySelector("[data-user-type]")?.value.trim() || "VISITOR",
        target_role_name: row.querySelector("[data-user-role]")?.value || null,
        target_status: row.querySelector("[data-user-status]")?.value || "pending"
      });

      if (error) {
        console.warn("Mise à jour accès impossible.", error);
        button.textContent = "Erreur";
        setTimeout(() => {
          button.disabled = false;
          button.textContent = originalText;
        }, 1200);
        return;
      }

      button.textContent = "Fait";
      await renderAdminRoles(client);
    });
  });
}

async function renderAdminCapacity(client) {
  const table = document.querySelector(".admin-overview-panel table");
  const [capacity, appointments] = await Promise.all([
    loadLibraryCapacity(client),
    selectAdminRows(client, "appointments", (query) =>
      query.select("*, profiles(full_name,email,member_code)").in("status", ["confirmed", "clocked_in"]).order("reservation_date", { ascending: false }).limit(50)
    )
  ]);
  const currentAppointments = appointments.filter((appointment) => ["confirmed", "clocked_in"].includes(appointment.status));
  const count = currentAppointments.length;
  updateAdminCapacityDisplay({ ...capacity, occupied_places: count, available_places: Math.max(Number(capacity.max_places || 20) - count, 0) });
  setupCapacitySettings(client);

  if (!appointments.length) {
    renderEmptyRow(table, 4, "Aucune présence enregistrée.");
    return;
  }

  table.querySelector("tbody").innerHTML = appointments
    .map((appointment) => {
      const profile = appointment.profiles || {};
      const member = profile.member_code || profile.email || profile.full_name || "-";
      return `<tr><td>${escapeHtml(member)}</td><td>${appointment.clock_in ? formatAdminDate(appointment.clock_in) : "-"}</td><td>${escapeHtml(appointment.start_time || "-")}</td><td><span class="status-pill info">${escapeHtml(appointment.status || "-")}</span></td></tr>`;
    })
    .join("");
}

function setupCapacitySettings(client) {
  const panel = document.querySelector("[data-superadmin-capacity-panel]");
  const form = document.querySelector("[data-capacity-settings-form]");
  if (!panel || !form) return;

  const isSuperAdmin = getProfileRole(state.auth.profile) === "SuperAdmin";
  panel.classList.toggle("hidden", !isSuperAdmin);
  if (!isSuperAdmin || form.dataset.bound === "true") return;
  form.dataset.bound = "true";

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.querySelector("[data-capacity-max-input]");
    const message = form.querySelector("[data-capacity-settings-message]");
    const submit = form.querySelector("button[type='submit']");
    const maxPlaces = Number(input?.value || 0);

    if (!Number.isInteger(maxPlaces) || maxPlaces < 1) {
      showAuthMessage(message, "Entrez une capacité valide.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Modification...";

    const { data, error } = await client.rpc("update_library_capacity", { new_max_places: maxPlaces });
    if (error) {
      console.warn("Modification capacité impossible.", error);
      const raw = `${error.message || ""}`.toLowerCase();
      const text = raw.includes("superadmin")
        ? "Seul le SuperAdmin peut modifier la capacité."
        : "Modification impossible pour le moment.";
      showAuthMessage(message, text, "error");
      submit.disabled = false;
      submit.textContent = "Modifier la capacité";
      return;
    }

    const capacity = Array.isArray(data) ? data[0] : data;
    if (capacity) updateAdminCapacityDisplay(capacity);
    showAuthMessage(message, "Capacité mise à jour.");
    submit.disabled = false;
    submit.textContent = "Modifier la capacité";
  });
}

async function hydrateAdminModule() {
  const module = document.body.dataset.adminModule;
  if (!module) return;
  const client = await getSupabaseClient();
  if (!client) return;

  const renderers = {
    overview: renderAdminOverview,
    capacity: renderAdminCapacity,
    catalogue: renderAdminCatalogue,
    events: renderAdminEvents,
    blog: renderAdminBlog,
    gallery: renderAdminGallery,
    payments: renderAdminPayments,
    roles: renderAdminRoles
  };

  await renderers[module]?.(client);
}

function setupNavigation() {
  const menuButton = document.querySelector("#mobile-menu-button");
  const mobilePanel = document.querySelector("#mobile-panel");
  if (!menuButton || !mobilePanel) return;

  menuButton.addEventListener("click", () => {
    const isOpen = !mobilePanel.classList.toggle("hidden");
    menuButton.setAttribute("aria-expanded", String(isOpen));
  });

  mobilePanel.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      mobilePanel.classList.add("hidden");
      menuButton.setAttribute("aria-expanded", "false");
    });
  });

  document.querySelectorAll("[data-logout]").forEach((button) => {
    button.addEventListener("click", async () => {
      await clearCurrentUser();
      window.location.href = route("index.html");
    });
  });
}

function setupAuthPage() {
  const tabs = document.querySelectorAll("[data-auth-tab]");
  const panels = document.querySelectorAll("[data-auth-panel]");
  if (!tabs.length || !panels.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => {
        const isActive = item === tab;
        item.classList.toggle("is-active", isActive);
        item.setAttribute("aria-selected", String(isActive));
      });
      panels.forEach((panel) => {
        panel.classList.toggle("hidden", panel.dataset.authPanel !== tab.dataset.authTab);
      });
    });
  });

  document.querySelector("[data-login-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector("[data-login-message]");
    const submit = form.querySelector('button[type="submit"]');
    const email = form.querySelector("[data-login-email]")?.value.trim();
    const password = form.querySelector("[data-login-password]")?.value;
    const client = await getSupabaseClient();

    if (!client) {
      showAuthMessage(message, "Configuration Supabase incomplète.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Connexion...";

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) {
      showAuthMessage(message, getAuthErrorMessage(error), "error");
      submit.disabled = false;
      submit.textContent = "Se connecter";
      return;
    }

    const user = await loadAuthState();
    if (!user || user.status !== "active") {
      const reason = user
        ? `Compte connecté, mais statut actuel: ${user.status}.`
        : "Compte connecté, mais profil introuvable ou illisible.";
      showAuthMessage(message, `${reason} Exécutez le script Supabase 04 puis reconnectez-vous.`, "error");
      await clearCurrentUser();
      submit.disabled = false;
      submit.textContent = "Se connecter";
      return;
    }

    const requested = getRequestedDestination(user.role);
    const target = user.role === "admin" && requested === "admin" ? "admin/index.html" : "adherent/index.html";
    window.location.href = route(target);
  });

  document.querySelector("[data-password-recovery]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    const form = button.closest("form");
    const message = form.querySelector("[data-login-message]");
    const email = form.querySelector("[data-login-email]")?.value.trim();
    const client = await getSupabaseClient();

    if (!email) {
      showAuthMessage(message, "Entre d'abord l'email du compte à réinitialiser.", "error");
      return;
    }

    if (!client) {
      showAuthMessage(message, "Configuration Supabase incomplète.", "error");
      return;
    }

    button.disabled = true;
    button.textContent = "Envoi du lien...";

    const { error } = await client.auth.resetPasswordForEmail(email, {
      redirectTo: getAuthRedirectUrl("auth/reset-password.html")
    });

    if (error) {
      showAuthMessage(message, getAuthErrorMessage(error), "error");
      button.disabled = false;
      button.textContent = "Envoyer un lien de réinitialisation";
      return;
    }

    showAuthMessage(message, `Lien envoyé à ${email}. Ouvre le nouvel email reçu.`);
    button.disabled = false;
    button.textContent = "Renvoyer le lien de réinitialisation";
  });

  document.querySelector("[data-signup-form]")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const message = form.querySelector("[data-signup-message]");
    const submit = form.querySelector('button[type="submit"]');
    const firstName = form.querySelector("[data-signup-first-name]")?.value.trim();
    const lastName = form.querySelector("[data-signup-last-name]")?.value.trim();
    const email = form.querySelector("[data-signup-email]")?.value.trim();
    const password = form.querySelector("[data-signup-password]")?.value;
    const client = await getSupabaseClient();

    if (!client) {
      showAuthMessage(message, "Configuration Supabase incomplète.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Envoi...";

    const { error } = await client.auth.signUp({
      email,
      password,
      options: {
        data: {
          full_name: `${firstName} ${lastName}`.trim(),
          phone: form.querySelector("[data-signup-phone]")?.value.trim(),
          profile: form.querySelector("[data-signup-profile]")?.value,
          institution: form.querySelector("[data-signup-institution]")?.value.trim(),
          motivation: form.querySelector("[data-signup-motivation]")?.value.trim()
        }
      }
    });

    if (error) {
      showAuthMessage(message, getAuthErrorMessage(error), "error");
      submit.disabled = false;
      submit.textContent = "Soumettre la demande";
      return;
    }

    showAuthMessage(message, "Demande enregistrée. L'administration procédera à la vérification.");
    form.reset();
    submit.disabled = false;
    submit.textContent = "Soumettre la demande";
  });
}

function setupPasswordResetPage() {
  const form = document.querySelector("[data-reset-password-form]");
  if (!form) return;
  const message = form.querySelector("[data-reset-message]");
  const params = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  const queryParams = new URLSearchParams(window.location.search);
  const urlError = params.get("error_description") || queryParams.get("error_description");
  const urlErrorCode = params.get("error_code") || queryParams.get("error_code");

  if (urlError || urlErrorCode) {
    showAuthMessage(message, getAuthErrorMessage({ message: urlError, code: urlErrorCode }), "error");
  }

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    const password = form.querySelector("[data-reset-password]")?.value;
    const confirmation = form.querySelector("[data-reset-confirm]")?.value;
    const client = await getSupabaseClient();

    if (!client) {
      showAuthMessage(message, "Configuration Supabase incomplète.", "error");
      return;
    }

    if (password !== confirmation) {
      showAuthMessage(message, "Les deux mots de passe ne correspondent pas.", "error");
      return;
    }

    submit.disabled = true;
    submit.textContent = "Enregistrement...";

    const { error } = await client.auth.updateUser({ password });
    if (error) {
      showAuthMessage(message, getAuthErrorMessage(error), "error");
      submit.disabled = false;
      submit.textContent = "Enregistrer le mot de passe";
      return;
    }

    showAuthMessage(message, "Mot de passe enregistré. Redirection vers la connexion...");
    setTimeout(() => {
      window.location.href = route("auth/login.html?next=admin");
    }, 1200);
  });
}

function setupLanguage() {
  const selects = [document.querySelector("#language-select"), document.querySelector("#mobile-language-select")].filter(Boolean);
  selects.forEach((select) => {
    select.value = state.language;
    select.addEventListener("change", () => {
      state.language = select.value;
      selects.forEach((item) => {
        item.value = state.language;
      });
      hydrate({ loadRemote: false });
    });
  });
}

function setupRevealAnimations() {
  const animatedElements = document.querySelectorAll(
    ".hero-band .eyebrow, .hero-band h1, .hero-band p, .hero-band .btn-primary, .hero-band .btn-secondary, .hero-panel, .home-banner, .gallery-portal, .gallery-grid figure, .institution-hero-card, .institution-visual-card, .glass-panel, .dashboard-hero, .dash-card, .conference-strip article, .feature-card, .book-card, .event-card, .blog-card"
  );

  animatedElements.forEach((element, index) => {
    element.classList.add("reveal-on-scroll");
    element.style.setProperty("--reveal-delay", `${Math.min(index * 45, 360)}ms`);
  });

  if (!("IntersectionObserver" in window)) {
    animatedElements.forEach((element) => element.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.12 }
  );

  animatedElements.forEach((element) => observer.observe(element));
}

async function hydrate({ loadRemote = true } = {}) {
  state.dictionary = applyTranslations(state.language);
  if (loadRemote) {
    await loadSupabaseContent();
  }
  setupFilters();
  setupEventFilters();
  setupGalleryFilters();
  renderBooks();
  renderEvents();
  renderPosts();
  renderGallery();
}

document.addEventListener("DOMContentLoaded", async () => {
  await loadAuthState();
  renderSharedLayout();
  syncSessionNavigation();
  const authorized = requireSession();
  markCurrentPage();
  setupNavigation();
  setupLanguage();
  setupAuthPage();
  setupPasswordResetPage();
  setupPasswordToggles();
  setupAdminSidebar();
  setupCustomAdminSelects();
  setupAdminUploadLimits();
  setupAdminPublishPreview();
  setupBookDetailsDialog();
  const catalogFilters = document.querySelector("#catalog-filters");
  const updateCatalog = () => {
    state.catalogPage = 1;
    renderBooks();
  };
  catalogFilters?.addEventListener("input", updateCatalog);
  catalogFilters?.addEventListener("change", updateCatalog);
  document.addEventListener("click", (event) => {
    const bookButton = event.target.closest("[data-book-open]");
    if (bookButton) openBookDetails(bookButton.dataset.bookOpen);
  });
  document.querySelector("#event-filters")?.addEventListener("input", renderEvents);
  document.querySelector("#gallery-filters")?.addEventListener("input", renderGallery);
  if (!authorized) return;
  await hydrate();
  await hydrateAdherentSpace();
  await hydrateAdminModule();
  setupFlyerLightbox();
  setupBlogInteractions();
  setupGalleryLightbox();
  setupRevealAnimations();
});
