## 1. Overview

A lightweight ERP for a manufacturing business that produces industrial automation parts. The POC validates the **full loop**: maintaining an article catalog, recording stock movements, and running production orders that consume components and yield finished goods — with reorder alerts and a minimal dashboard.

This is a proof of concept: a single-page vanilla HTML/JS app with data persisted in the browser's `localStorage`. No authentication, no server, no multi-user concerns.

---

## 2. Goals & Non-Goals

### 2.1 Goals
* Manage articles (raw, semi-finished, finished) with full CRUD.
* Record manual stock movements (in/out).
* Run production orders that deduct components and add finished output, blocking when stock is insufficient.
* Surface two KPIs: low-stock items and "what can I make now."

### 2.2 Non-Goals (out of scope for POC)
* User authentication / roles.
* Cost valuation, pricing, purchasing, sales, invoicing.
* Recursive/auto-exploded BOMs (nesting is fixed at one level per tier).
* Server-side persistence, multi-device sync, or concurrent users.

---

## 3. Users

Single unauthenticated user (owner/operator). No login screen. All data local to the browser.

---

## 4. Domain Model

### 4.1 Article
Every article has a unique **head** (id) and a **type**.

| Field | Type | Applies to | Notes |
|---|---|---|---|
| `head` | string | all | Unique identifier (primary key) |
| `name` | string | all | Human-readable label |
| `type` | enum | all | `raw` \| `semi` \| `finished` |
| `qty` | int | all | Current on-hand stock |
| `min_qty` | int | raw | Reorder threshold; triggers low-stock alert |
| `bom` | dict[str, int] | semi, finished | Map of component `head` → required qty |

### 4.2 BOM (Bill of Materials) rules
* **raw** — no BOM. Has `min_qty`.
* **semi** — `bom` references **raw** articles only.
* **finished** — `bom` references **raw** and/or **semi** articles.

Nesting is **fixed at these three tiers**. A finished good's BOM is *not* auto-exploded: if it needs a semi-finished component, that semi must already exist in stock (produced via its own production order first).

### 4.3 Stock Movement

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `head` | string | Article affected |
| `direction` | enum | `in` \| `out` |
| `qty` | int | Quantity moved |
| `reason` | string | Free text (e.g. purchase, adjustment) |
| `timestamp` | datetime | Auto |

### 4.4 Production Order

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique |
| `output_head` | string | The semi/finished article being produced |
| `planned_qty` | int | Requested output quantity |
| `produced_qty` | int | Actual good units yielded |
| `scrap_qty` | int | Units lost/rejected |
| `timestamp` | datetime | Auto |

---

## 5. Functional Requirements

### 5.1 Article Master (CRUD)
* Create, read, update, delete articles.
* Form adapts by type: `min_qty` shown for raw; BOM builder shown for semi/finished.
* BOM builder validates component references (semi → raw only; finished → raw/semi).
* Prevent deleting an article used in another article's BOM.

### 5.2 Stock Movement Entry
* Manual `in`/`out` entry per article.
* Every movement updates the article's `qty` and appends to a movement log.

### 5.3 Production Order (core logic)
On running a production order for `output_head` × `planned_qty`:
1. **Check availability** — for each BOM component, required = `bom[component] * planned_qty`. If any component has `qty < required`, **block** the order and report the shortfall(s).
2. **Deduct components** — subtract required qty from each component.
3. **Add output** — increase `output_head.qty` by `produced_qty`.
4. **Scrap tracking** — allow `scrap_qty`; components are consumed for the full `planned_qty`, while only `produced_qty` (= planned - scrap) is added to stock.
5. Record the production order and the resulting stock movements.

> Note: because BOMs are not auto-exploded, producing a finished good requires its semi components to be in stock first.

### 5.4 Dashboard / KPIs
* **Low-stock alerts** — list raw articles where `qty < min_qty`.
* **Producible now** — for each semi/finished article, the max whole units producible from current component stock: `min over components of floor(qty / bom[component])`.

---

## 6. Technical Approach (POC)

* **Frontend:** Vanilla HTML/CSS/JavaScript, no framework.
* **Persistence:** Browser `localStorage` (JSON-serialized collections: `articles`, `movements`, `productionOrders`).
* **Architecture:** Multi-page app with separate HTML files per section – `index.html` (Dashboard), `articles.html` (Article Master), `stock.html` (Stock Movements), `production.html` (Production Orders) – linked via a shared top navigation bar.
* **Data access:** A thin JS storage module wrapping `localStorage` get/set, so it can later be swapped for a REST backend without touching UI logic.

---

## 7. Data Integrity Rules

* `head` must be unique across all articles.
* Stock `qty` never goes negative (production is blocked; manual `out` movements are validated).
* BOM component references must point to existing articles of the allowed type.
* Deletion blocked when an article is referenced by another BOM or has movement history.

---

## 8. Success Criteria

* A user can define a raw → semi → finished chain end to end.
* Running a production order correctly consumes components, blocks on shortage, and reflects scrap.
* Dashboard accurately shows low-stock items and producible quantities in real time.