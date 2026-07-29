import { Check, Pencil, Plus, RefreshCcw, Search, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { createCatalogProduct, fetchBranchOptions, fetchCatalogProducts, readStoredAuth, resolveMediaUrl, updateCatalogProduct, uploadProductImage, type BranchOption, type ProductPayload } from "../../shared/api/client";
import { useTenantSettings } from "../../shared/hooks/useTenantSettings";
import type { Product, ProductCategory } from "./types";

const defaultTaxRate = 0.075;
const fallbackBranches: BranchOption[] = [];
type StockFilter = "" | "stocked" | "low" | "out" | "services";

function isServiceCategory(category: string) {
  return category.trim().toLowerCase() === "services";
}

function blankProduct(taxRate = defaultTaxRate, branchId = ""): ProductPayload {
  return {
  branchId,
  name: "",
  sku: "",
  barcode: "",
  category: "" as ProductCategory,
  price: 0,
  cost: 0,
  taxRate,
  image: "",
  stock: 0,
  reorderPoint: 0,
  station: "" as ProductPayload["station"],
  modifiers: []
  };
}

export function CatalogView() {
  const storedAuth = useMemo(() => readStoredAuth(), []);
  const activeBranchId = storedAuth?.session.branchId ?? storedAuth?.staff.branchId ?? "";
  const activeUserId = storedAuth?.staff.id ?? "";
  const [products, setProducts] = useState<Product[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<Product | null>(null);
  const [branches, setBranches] = useState<BranchOption[]>(fallbackBranches);
  const { settings, displayMoney } = useTenantSettings();
  const tenantTaxRate = settings?.defaultTaxRate ?? defaultTaxRate;
  const categories = settings?.productCategories.length ? settings.productCategories : [];
  const [form, setForm] = useState<ProductPayload>(blankProduct(defaultTaxRate, activeBranchId));
  const [modalOpen, setModalOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [branchFilter, setBranchFilter] = useState(activeBranchId);
  const [stockFilter, setStockFilter] = useState<StockFilter>("");
  const [status, setStatus] = useState("Ready");
  const selectedFilterBranch = useMemo(() => branches.find((branch) => branch.id === branchFilter) ?? null, [branchFilter, branches]);
  const selectedFormBranch = useMemo(() => branches.find((branch) => branch.id === form.branchId) ?? null, [form.branchId, branches]);
  const branchLocked = Boolean(activeBranchId && branches.length === 1);
  const categoryUsage = useMemo(
    () =>
      categories.map((category) => ({
        category,
        count: products.filter((product) => product.category === category).length
      })),
    [categories.join("|"), products]
  );

  const marginPreview = useMemo(() => {
    if (form.price === 0) {
      return 0;
    }

    return Math.round(((form.price - form.cost) / form.price) * 100);
  }, [form.cost, form.price]);

  const filteredProducts = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return products.filter((product) => {
      const queryMatch = normalizedQuery
        ? [product.name, product.sku, product.barcode, product.category, product.station].some((value) => value.toLowerCase().includes(normalizedQuery))
        : true;
      const categoryMatch = categoryFilter ? product.category === categoryFilter : true;
      const branchMatch = branchFilter ? product.branchId === branchFilter : true;
      const service = isServiceCategory(product.category);
      const stockMatch =
        !stockFilter ||
        (stockFilter === "services" && service) ||
        (stockFilter === "stocked" && !service && product.stock > product.reorderPoint) ||
        (stockFilter === "low" && !service && product.stock > 0 && product.stock <= product.reorderPoint) ||
        (stockFilter === "out" && !service && product.stock <= 0);

      return queryMatch && categoryMatch && branchMatch && stockMatch;
    });
  }, [branchFilter, categoryFilter, products, query, stockFilter]);

  async function loadProducts() {
    try {
      const [catalogResponse, branchResponse] = await Promise.all([fetchCatalogProducts(), fetchBranchOptions()]);
      setProducts(catalogResponse.products);
      setBranches(branchResponse.branches);
      setStatus("Catalog synced");
    } catch (error) {
      setProducts([]);
      setBranches(fallbackBranches);
      setStatus(error instanceof Error ? error.message : "Unable to load catalog");
    }
  }

  useEffect(() => {
    void loadProducts();
  }, []);

  useEffect(() => {
    setForm((current) => (selectedProduct ? current : { ...current, taxRate: tenantTaxRate }));
  }, [selectedProduct, tenantTaxRate, categories.join("|")]);

  function editProduct(product: Product) {
    setSelectedProduct(product);
    setForm({
      ...product
    });
    setModalOpen(true);
  }

  function resetForm() {
    setSelectedProduct(null);
    setForm(blankProduct(tenantTaxRate, activeBranchId));
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSelectedProduct(null);
    setForm(blankProduct(tenantTaxRate, activeBranchId));
  }

  function updateForm<K extends keyof ProductPayload>(key: K, value: ProductPayload[K]) {
    setForm((current) => {
      const next = { ...current, [key]: value };
      return key === "category" && isServiceCategory(String(value)) ? { ...next, stock: 0, reorderPoint: 0 } : next;
    });
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();

    if (!form.category) {
      setStatus("Select a category");
      return;
    }

    if (!form.branchId) {
      setStatus("Select a branch");
      return;
    }

    if (!form.station) {
      setStatus("Select a station");
      return;
    }

    if (!form.image) {
      setStatus("Upload a product image");
      return;
    }

    setStatus(selectedProduct ? "Updating product..." : "Creating product...");

    try {
      const response = selectedProduct
        ? await updateCatalogProduct(selectedProduct.id, form, form.branchId, activeUserId)
        : await createCatalogProduct(form, activeUserId);

      setProducts((current) => {
        const existing = current.some((product) => product.id === response.product.id);
        return existing
          ? current.map((product) => (product.id === response.product.id ? response.product : product))
          : [response.product, ...current];
      });
      setStatus(selectedProduct ? "Product updated" : "Product created");
      closeModal();
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to save product");
    }
  }

  async function handleImageUpload(file: File | undefined) {
    if (!file) return;

    const uploadBranchId = form.branchId || activeBranchId;
    if (!uploadBranchId) {
      setStatus("Select a branch before uploading product image");
      return;
    }

    setStatus("Uploading product image...");

    try {
      const response = await uploadProductImage(file, uploadBranchId, activeUserId);
      updateForm("image", response.imagePath);
      setStatus("Product image saved locally");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Unable to upload product image");
    }
  }

  function branchName(nextBranchId: string) {
    return branches.find((branch) => branch.id === nextBranchId)?.name ?? nextBranchId;
  }

  function stockLabel(product: Product) {
    if (isServiceCategory(product.category)) return "Service";
    if (product.stock <= 0) return "Out of stock";
    if (product.stock <= product.reorderPoint) return `${product.stock} low`;
    return `${product.stock} in stock`;
  }

  function stockClass(product: Product) {
    if (isServiceCategory(product.category)) return "catalog-stock-service";
    if (product.stock <= 0) return "catalog-stock-empty";
    if (product.stock <= product.reorderPoint) return "catalog-stock-low";
    return "catalog-stock-ok";
  }

  function clearFilters() {
    setQuery("");
    setBranchFilter(activeBranchId);
    setCategoryFilter("");
    setStockFilter("");
  }

  return (
    <div className="module-view">
      <div className="module-heading">
        <div>
          <p className="eyebrow">Products, menus and pricing</p>
          <h1>Catalog management</h1>
        </div>
        <div className="button-group">
          <button className="secondary-button" onClick={loadProducts}><RefreshCcw size={18} /> Sync</button>
          <button className="primary-button" onClick={resetForm}><Plus size={18} /> Add product</button>
        </div>
      </div>

      <section className="category-summary-strip">
        {categoryUsage.map((item) => (
          <span key={item.category}>
            <strong>{item.category}</strong>
            <small>{item.count} items</small>
          </span>
        ))}
      </section>

      <section className="catalog-filter-bar">
        <label className="search-box compact-search">
          <Search size={16} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search product, SKU or barcode" />
          {query ? (
            <button type="button" onClick={() => setQuery("")} aria-label="Clear product search"><X size={14} /></button>
          ) : null}
        </label>
        {branchLocked ? (
          <span className="locked-select-value locked-select-value-compact catalog-branch-lock">
            <strong>{selectedFilterBranch?.name ?? activeBranchId}</strong>
            <small>{selectedFilterBranch?.status ?? "assigned"}</small>
          </span>
        ) : (
          <select className="compact-select" value={branchFilter} onChange={(event) => setBranchFilter(event.target.value)}>
            <option value="">Branch</option>
            {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </select>
        )}
        <select className="compact-select" value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}>
          <option value="">Category</option>
          {categories.map((category) => <option key={category} value={category}>{category}</option>)}
        </select>
        <select className="compact-select" value={stockFilter} onChange={(event) => setStockFilter(event.target.value as StockFilter)}>
          <option value="">Stock status</option>
          <option value="stocked">In stock</option>
          <option value="low">Low stock</option>
          <option value="out">Out of stock</option>
          <option value="services">Services</option>
        </select>
        {(query || branchFilter !== activeBranchId || categoryFilter || stockFilter) ? (
          <button className="secondary-button" type="button" onClick={clearFilters}>Clear filters</button>
        ) : null}
        <span>{filteredProducts.length} products</span>
      </section>

      <div className="catalog-workflow catalog-workflow-full">
        <section className="catalog-grid">
          {filteredProducts.length === 0 ? (
            <div className="empty-state">No catalog products found.</div>
          ) : filteredProducts.map((product) => (
            <article className="catalog-card" key={product.id}>
              <img src={resolveMediaUrl(product.image)} alt="" />
              <div>
                <span>{product.category}</span>
                <h2>{product.name}</h2>
                <p>{product.sku} - {product.station}</p>
                <div className="catalog-card-meta">
                  <small>{branchName(product.branchId)}</small>
                  <small className={stockClass(product)}>{stockLabel(product)}</small>
                </div>
              </div>
              <footer>
                <strong>{displayMoney(product.price)}</strong>
                <button onClick={() => editProduct(product)} aria-label={`Edit ${product.name}`}><Pencil size={16} /></button>
              </footer>
            </article>
          ))}
        </section>
      </div>
      {modalOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={closeModal}>
          <section className="modal-panel product-modal" role="dialog" aria-modal="true" aria-labelledby="product-modal-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">{selectedProduct ? "Update catalog item" : "Create catalog item"}</p>
                <h2 id="product-modal-title">{selectedProduct ? "Edit product" : "Add product"}</h2>
              </div>
              <button className="icon-button" onClick={closeModal} aria-label="Close product modal"><X size={18} /></button>
            </div>
            <form className="catalog-form" onSubmit={saveProduct}>
              <label>
                Product name
                <input value={form.name} onChange={(event) => updateForm("name", event.target.value)} required />
              </label>
              <label>
                Branch
                {branchLocked ? (
                  <span className="locked-select-value">
                    <strong>{selectedFormBranch?.name ?? form.branchId}</strong>
                    <small>{selectedFormBranch?.status ?? "assigned"}</small>
                  </span>
                ) : (
                  <select value={form.branchId} onChange={(event) => updateForm("branchId", event.target.value)} required>
                    <option value="">Branch</option>
                    {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name} - {branch.status}</option>)}
                  </select>
                )}
              </label>
              <label>
                SKU
                <input value={form.sku} onChange={(event) => updateForm("sku", event.target.value.toUpperCase())} required />
              </label>
              <label>
                Barcode
                <input value={form.barcode} onChange={(event) => updateForm("barcode", event.target.value)} required />
              </label>
              <label>
                Category
                <select value={form.category} onChange={(event) => updateForm("category", event.target.value as ProductCategory)}>
                  <option value="">Category</option>
                  {categories.map((category) => <option key={category} value={category}>{category}</option>)}
                </select>
              </label>
              <label>
                Price
                <input min="0" type="number" value={form.price} onChange={(event) => updateForm("price", Number(event.target.value))} required />
              </label>
              <label>
                Cost
                <input min="0" type="number" value={form.cost} onChange={(event) => updateForm("cost", Number(event.target.value))} required />
              </label>
              <label>
                VAT rate
                <input
                  max={1}
                  min={0}
                  step={0.001}
                  type="number"
                  value={form.taxRate}
                  onChange={(event) => updateForm("taxRate", Number(event.target.value))}
                  required
                />
              </label>
              <label>
                Stock
                <input disabled={isServiceCategory(form.category)} min="0" type="number" value={form.stock} onChange={(event) => updateForm("stock", Number(event.target.value))} required />
              </label>
              <label>
                Reorder point
                <input disabled={isServiceCategory(form.category)} min="0" type="number" value={form.reorderPoint} onChange={(event) => updateForm("reorderPoint", Number(event.target.value))} required />
              </label>
              <label>
                Station
                <select value={form.station} onChange={(event) => updateForm("station", event.target.value as ProductPayload["station"])}>
                  <option value="">Station</option>
                  <option value="Kitchen">Kitchen</option>
                  <option value="Bar">Bar</option>
                  <option value="Counter">Counter</option>
                </select>
              </label>
              <label className="wide-field">
                Product image
                <div className="image-upload-control">
                  {form.image ? <img src={resolveMediaUrl(form.image)} alt="" /> : <span>No image uploaded</span>}
                  <input
                    accept="image/png,image/jpeg,image/webp,image/gif"
                    onChange={(event) => void handleImageUpload(event.target.files?.[0])}
                    type="file"
                  />
                  <small>{form.image ? "Saved locally for offline use" : "PNG, JPG, WEBP or GIF"}</small>
                </div>
              </label>
              <label className="wide-field">
                Modifiers
                <input
                  value={form.modifiers.join(", ")}
                  onChange={(event) => updateForm("modifiers", event.target.value.split(",").map((item) => item.trim()).filter(Boolean))}
                  placeholder="Extra cheese, No onions"
                />
              </label>
              <div className="form-summary">
                <span>VAT {Math.round(form.taxRate * 1000) / 10}%</span>
                <span>Margin {marginPreview}%</span>
                <span>{status}</span>
                <button className="primary-button" type="submit"><Check size={18} /> Save</button>
              </div>
            </form>
          </section>
        </div>
      ) : null}
    </div>
  );
}
