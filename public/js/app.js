function pad2(n) {
  return String(n).padStart(2, '0');
}

function monthKey(year, month) {
  return `${year}-${pad2(month)}`;
}

function formatMonthLabel(year, month) {
  const d = new Date(year, month - 1, 1);
  return d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

function toPath(year, month) {
  return `./public/content/${year}/${pad2(month)}.json`;
}

function isNonEmptyArray(v) {
  return Array.isArray(v) && v.length > 0;
}

async function fetchMonthItems(year, month) {
  const url = toPath(year, month);
  const res = await fetch(url, { cache: 'no-store' });

  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Failed to load ${url} (${res.status})`);

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

function compareYm(a, b) {
  if (a.year !== b.year) return a.year - b.year;
  return a.month - b.month;
}

function addMonths(ym, delta) {
  const base = ym.year * 12 + (ym.month - 1);
  const next = base + delta;
  return { year: Math.floor(next / 12), month: (next % 12) + 1 };
}

function buildMonthRangeInclusive(start, end) {
  const out = [];
  let cur = { ...start };
  while (compareYm(cur, end) <= 0) {
    out.push({
      year: cur.year,
      month: cur.month,
      key: monthKey(cur.year, cur.month),
      label: formatMonthLabel(cur.year, cur.month),
    });
    cur = addMonths(cur, 1);
  }
  return out;
}

export default {
  data() {
    const now = new Date();
    const current = { year: now.getFullYear(), month: now.getMonth() + 1 };
    const start = { year: 2025, month: 1 };
    const end = addMonths(current, 1); // through next month

    return {
      siteTitle: 'Unmanned Oops',
      siteSubtitle:
        'A systemic archive of operational and reliability failures from aggressive AI-driven workforce displacement.',
      repoUrl: 'https://github.com/yushanmufeng/unmanned-oops',

      months: buildMonthRangeInclusive(start, end),
      selected: current,
      items: [],
      loading: false,
      error: '',
      resolvedFrom: null, // {year,month} if fallback used
      pendingKey: '',

      // Lightweight in-memory cache & metadata (no build / no service worker).
      // monthKey -> items[]
      itemsCache: Object.create(null),
      // monthKey -> { count: number|null, status: 'idle'|'loading'|'ready'|'error' }
      monthMeta: Object.create(null),
    };
  },

  computed: {
    selectedKey() {
      return monthKey(this.selected.year, this.selected.month);
    },
    selectedLabel() {
      return formatMonthLabel(this.selected.year, this.selected.month);
    },
    resolvedLabel() {
      if (!this.resolvedFrom) return '';
      return formatMonthLabel(this.resolvedFrom.year, this.resolvedFrom.month);
    },
    monthsDesc() {
      return [...this.months].reverse();
    },
  },

  methods: {
    getCountLabel(key) {
      const meta = this.monthMeta[key];
      if (!meta || meta.count === null || meta.count === undefined) return '—';
      return String(meta.count);
    },

    async loadMonthIntoCache(ym) {
      const key = monthKey(ym.year, ym.month);
      if (this.itemsCache[key]) return this.itemsCache[key];

      this.monthMeta[key] = this.monthMeta[key] || {
        count: null,
        status: 'idle',
      };
      this.monthMeta[key].status = 'loading';

      try {
        const data = await fetchMonthItems(ym.year, ym.month);
        this.itemsCache[key] = data;
        this.monthMeta[key] = { count: data.length, status: 'ready' };
        return data;
      } catch (e) {
        this.monthMeta[key] = { count: null, status: 'error' };
        throw e;
      }
    },

    async prefetchAllMonths() {
      // Sequential prefetch to avoid spiky network usage on first load.
      for (const m of this.monthsDesc) {
        const key = m.key;
        const meta = this.monthMeta[key];
        if (meta && (meta.status === 'ready' || meta.status === 'loading')) continue;

        try {
          await this.loadMonthIntoCache({ year: m.year, month: m.month });
        } catch {
          // Ignore: missing files (404) are treated as empty by fetchMonthItems,
          // other errors should not block the rest of the prefetch.
        }

        // Small yield to keep the UI responsive.
        await new Promise((r) => setTimeout(r, 35));
      }
    },

    async selectMonth(ym, { allowFallback = false } = {}) {
      this.selected = { year: ym.year, month: ym.month };
      this.loading = true;
      this.error = '';
      this.resolvedFrom = null;
      this.pendingKey = monthKey(ym.year, ym.month);

      try {
        const data = await this.loadMonthIntoCache(ym);
        this.items = data;

        if (allowFallback && !isNonEmptyArray(data)) {
          await this.selectLatestNonEmptyFrom(ym);
        }
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      } finally {
        this.loading = false;
        this.pendingKey = '';
      }
    },

    async selectLatestNonEmptyFrom(startYm) {
      const rangeStart = { year: 2025, month: 1 };
      let cursor = { ...startYm };

      while (compareYm(cursor, rangeStart) >= 0) {
        const data = await this.loadMonthIntoCache(cursor);
        if (isNonEmptyArray(data)) {
          this.selected = { ...cursor };
          this.items = data;
          this.resolvedFrom =
            cursor.year === startYm.year && cursor.month === startYm.month
              ? null
              : { ...cursor };
          return;
        }
        cursor = addMonths(cursor, -1);
      }

      // no data found at all
      this.items = [];
      this.resolvedFrom = null;
    },

    openSource(url) {
      if (!url) return;
      window.open(url, '_blank', 'noopener,noreferrer');
    },
  },

  async mounted() {
    // On first visit: default to current month; if empty/missing, walk backward.
    await this.selectMonth(this.selected, { allowFallback: true });

    // Background warmup: prefetch + count all months for the selector.
    // Fire-and-forget (no await) to keep first paint fast.
    this.prefetchAllMonths();
  },

  template: `
    <div class="container">
      <header class="header">
        <div class="brand">
          <h1>{{ siteTitle }}</h1>
          <p>{{ siteSubtitle }}</p>
        </div>
        <div class="actions" aria-label="Project links">
          <a class="btn" :href="repoUrl" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
              <path fill="currentColor" d="M8 0C3.58 0 0 3.65 0 8.15c0 3.6 2.29 6.65 5.47 7.73.4.08.55-.17.55-.39 0-.19-.01-.82-.01-1.49-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.52-.01-.53.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.2-3.64-.92-3.64-4.06 0-.9.31-1.64.82-2.22-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.84a7.3 7.3 0 0 1 2-.28c.68 0 1.36.09 2 .28 1.53-1.06 2.2-.84 2.2-.84.44 1.1.16 1.92.08 2.12.51.58.82 1.31.82 2.22 0 3.15-1.87 3.86-3.65 4.06.29.25.54.74.54 1.49 0 1.08-.01 1.95-.01 2.22 0 .22.15.48.55.39A8.1 8.1 0 0 0 16 8.15C16 3.65 12.42 0 8 0z"></path>
            </svg>
            <span>View on GitHub</span>
          </a>
          <div class="pill" title="No server, no build step">
            <span>Static</span>
            <span aria-hidden="true">•</span>
            <span>Vue 3</span>
            <span aria-hidden="true">•</span>
            <span>ES Modules</span>
          </div>
        </div>
      </header>

      <section class="layout">
        <aside class="panel">
          <div class="panel-header">
            <div class="title">Browse by month</div>
          </div>
          <div class="months" role="list" aria-label="Month selector">
            <button
              v-for="m in monthsDesc"
              :key="m.key"
              class="month-btn"
              type="button"
              role="listitem"
              :aria-current="m.key === selectedKey ? 'true' : 'false'"
              @click="selectMonth({ year: m.year, month: m.month })"
            >
              <span class="k">{{ m.key }}</span>
              <span class="v">{{ m.label }}</span>
              <span class="count" :title="'Entries in ' + m.key">
                {{ getCountLabel(m.key) }} entries
              </span>
            </button>
          </div>
        </aside>

        <main class="panel main">
          <div class="main-top">
            <div class="h">
              <h2>{{ selectedLabel }}</h2>
              <p v-if="resolvedFrom">
                No entries found for the current month; showing the latest non-empty month:
                <strong>{{ resolvedLabel }}</strong>
              </p>
              <p v-else>
                Select a month to review documented incidents for that period.
              </p>
            </div>
            <div class="pill">
              <span v-if="loading">Loading…</span>
              <span v-else>{{ items.length }} entries</span>
            </div>
          </div>

          <div v-if="error" class="state">
            <div class="danger"><strong>Load error:</strong> {{ error }}</div>
            <div style="margin-top: 8px; color: var(--muted-2); font-size: 12px;">
              Tip: missing month files (404) are treated as empty; other HTTP errors will show here.
            </div>
          </div>

          <div v-else-if="loading" class="state">
            <strong>Loading</strong> entries for {{ selectedKey }}…
          </div>

          <div v-else-if="items.length === 0" class="state">
            <strong>No entries</strong> for this month yet.
            <div style="margin-top: 6px; color: var(--muted-2); font-size: 12px;">
              The archive for this month has not been populated yet.
            </div>
          </div>

          <section v-else class="grid" aria-label="Archive entries">
            <article v-for="(it, idx) in items" :key="it.url || it.title || idx" class="card">
              <h3>
                <a
                  v-if="it.url"
                  :href="it.url"
                  target="_blank"
                  rel="noopener noreferrer"
                >{{ it.title || 'Untitled' }}</a>
                <span v-else>{{ it.title || 'Untitled' }}</span>
              </h3>

              <div class="meta">
                <span v-if="it.time">{{ it.time }}</span>
              </div>

              <p v-if="it.description" class="desc">{{ it.description }}</p>
              <p v-else class="desc" style="color: var(--muted-2);">No description.</p>

              <div v-if="Array.isArray(it.tags) && it.tags.length" class="tags" aria-label="Tags">
                <span v-for="t in it.tags" :key="t" class="tag">{{ t }}</span>
              </div>
            </article>
          </section>

          <footer class="footer" aria-label="Footer">
            <div>
              Project repository:
              <a :href="repoUrl" target="_blank" rel="noopener noreferrer">{{ repoUrl }}</a>
            </div>
            <div>MIT License</div>
          </footer>
        </main>
      </section>
    </div>
  `,
};

