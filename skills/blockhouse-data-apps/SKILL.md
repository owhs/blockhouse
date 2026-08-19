---
name: blockhouse-data-apps
description: Build business applications inside Blockhouse with the Data plugin — custom tables with typed and calculated fields, line-items, relations, conditional visibility and validation, approval workflows, gantt/calendar/kanban views, Liquid report templates (quotes, invoices, certificates), public APIs, and automations that tie them to forms and integrations. Use when the user wants a quote calculator, an inventory system, a booking or approval pipeline, a CRM-ish tracker, or any structured data tool rather than editorial pages.
---

# Building data apps in Blockhouse

The Data plugin turns a table definition into a full admin CRUD interface, a validating form, calculated totals, a workflow, a report and an API — from JSON, without writing a plugin. Reach for `blockhouse-plugin-dev` only when you need behaviour the table definition cannot express.

## Defining a table

Tables live under Data & apps in the studio, or as JSON via `/api/res/data/tables`. Shape:

```json
{
  "id": "quotes", "label": "Quotes", "titleField": "client", "icon": "form",
  "fields": [ /* FieldDef[] */ ],
  "workflow": { "states": [...], "transitions": [...] },
  "dateField": "startDate", "endDateField": "dueDate",
  "report": "<liquid template>",
  "publicRead": false, "publicWrite": false
}
```

## Field types

`text` `textarea` `number` `currency` `boolean` `date` `select` `multiselect` `relation` `computed` `lineitems`.

- **`relation`** points at another table id; the field renders as a picker and stores the row id. This is how you link a quote to a client, or stock movements to a product.
- **`lineitems`** is a repeating sub-table. Define its columns in `item[]` — each supports `computed` too, so a row can carry `qty * price` while the parent carries the sum.
- **`computed`** holds a safe expression evaluated server-side on every write (never `eval`). Arithmetic, comparisons, `round()`, `min()`, `max()`, `abs()`, and the aggregates `sum(field, "column")`, `count(field)`, `avg(field, "column")`.
- **`group`** puts fields under a heading; **`showIf`** is an expression controlling visibility; **`validate`** is an expression that must be truthy to save; **`required`** and **`default`** behave as expected.

## A quote calculator, end to end

```json
{ "key": "lines", "type": "lineitems", "label": "Items",
  "item": [
    { "key": "desc",  "type": "text",     "label": "Description" },
    { "key": "qty",   "type": "number",   "label": "Qty", "default": 1 },
    { "key": "price", "type": "currency", "label": "Unit price", "currency": "£" },
    { "key": "total", "type": "computed", "label": "Total", "computed": "qty * price" }
  ] },
{ "key": "subtotal", "type": "computed", "label": "Subtotal", "currency": "£",
  "computed": "round(sum(lines, \"total\"), 2)" },
{ "key": "vatRate",  "type": "number",   "label": "VAT %", "default": 20 },
{ "key": "vat",      "type": "computed", "label": "VAT",
  "computed": "round(subtotal * vatRate / 100, 2)" },
{ "key": "total",    "type": "computed", "label": "Total", "currency": "£",
  "computed": "round(subtotal + vat, 2)" },
{ "key": "discount", "type": "number", "label": "Discount %",
  "showIf": "total > 5000", "validate": "discount >= 0 and discount <= 25" }
```

Computed fields recalculate on save, so totals in the list view, the report and the API always agree.

## Workflows and approvals

```json
"workflow": {
  "states": [
    { "key": "draft",    "label": "Draft" },
    { "key": "review",   "label": "In review" },
    { "key": "approved", "label": "Approved", "role": "admin" },
    { "key": "sent",     "label": "Sent" }
  ],
  "transitions": [
    { "from": "draft",  "to": "review" },
    { "from": "review", "to": "approved", "role": "admin" },
    { "from": "review", "to": "draft" },
    { "from": "approved", "to": "sent" }
  ]
}
```

Transitions are enforced server-side — an unlisted jump is rejected, and a `role` on a state or transition means only that role or higher may perform it. Each transition emits `data.transition`, which automations can listen for.

## Views

Set `dateField` (and optionally `endDateField`) to unlock calendar and gantt views alongside the table and kanban. Kanban groups by the workflow state automatically. These are display choices on the same rows — no duplication.

## Reports

`report` is a Liquid template rendered at `/x/data/report/<table>/<row>`, with `row`, `table` and `site` in scope. This is how quotes, invoices, certificates and packing slips get produced. Keep it self-contained — it inherits the site's tokens, so `var(--accent)` and the type scale are available and it prints consistently.

## Wiring it to the rest of the site

Forms → data: the Forms plugin can write a submission straight into a table, so a public quote request becomes a draft row.

Automations: the `data.insert`, `data.update` and `data.transition` events trigger recipes; actions include sending mail, calling a connector (`google.gmail_send`, `xero.create_invoice`, `zapier.catch_hook`, `rest.request`), and writing content. A quote approved in the workflow can create the Xero invoice and email the client without leaving Blockhouse.

Public API: `publicRead`/`publicWrite` expose `/x/data/api/<table>` behind an API key. Keep both off unless something external genuinely needs them, and prefer read-only.

## Practical advice

Model the nouns before the screens — get tables and relations right and the interface follows. Put money in `currency` fields and compute in minor units where rounding matters. Use `validate` for business rules and `showIf` for progressive disclosure rather than building three near-identical tables. Name computed fields for what they mean (`total`), not how they are derived (`sumTimesVat`), because those names appear in reports and API responses.
