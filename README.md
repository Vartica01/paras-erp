# ParasERP MVP

A lightweight browser-based ERP prototype for managing articles, stock, and production.

## How to Use

### 1. Dashboard

The **Dashboard** shows:
- Total articles
- Total on-hand units
- Low-stock raw materials
- How many semi-finished/finished items can currently be produced

### 2. Articles

Use **Articles** to create and manage items.

- Raw materials have no BOM.
- Semi-finished items can use raw materials.
- Finished items can use raw or semi-finished items.
- Article codes must be unique.

Articles cannot be deleted if they are referenced by a BOM or have stock movement history.

### 3. Stock

Use **Stock** to record manual stock movements.

- **Stock In** increases quantity.
- **Stock Out** decreases quantity.
- Stock cannot become negative.
- All movements are recorded in the history.

### 4. Production

Use **Production** to create a production order.

Enter the output article, planned quantity, and scrap quantity.

The system:
1. Checks BOM component availability.
2. Blocks production if stock is insufficient.
3. Consumes the required components.
4. Adds `planned quantity - scrap quantity` to finished stock.
5. Records the production order and stock movements.

### 5. Suggested Test Flow

1. Review the seeded articles on the Dashboard.
2. Check their BOMs under **Articles**.
3. Add/remove inventory under **Stock**.
4. Produce a semi-finished item under **Production**.
5. Produce a finished item using the semi-finished item.
6. Check the Dashboard to verify stock and producible quantities.
7. Try producing more than available stock to test shortage validation.



