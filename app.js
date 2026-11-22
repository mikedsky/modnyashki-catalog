// Telegram WebApp initialization
const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (tg.BackButton) {
    tg.BackButton.onClick(() => {
      closeModal();
    });
  }
}

// Global State
let allProducts = [];
let allCategories = [];
let filteredProducts = [];
let displayedCount = 0;
const BATCH_SIZE = 24;
let botUsername = "Clothesshopua_bot";

let activeCategoryId = 0;
let searchQuery = "";
let onlyInStock = false;
let onlyDiscount = false;
let onlyNew = false;
let selectedSize = "";
let currentModalProduct = null;

// DOM Elements
const searchInput = document.getElementById("searchInput");
const searchClearBtn = document.getElementById("searchClearBtn");
const categoriesNav = document.getElementById("categoriesNav");
const productsGrid = document.getElementById("productsGrid");
const emptyState = document.getElementById("emptyState");
const resetFiltersBtn = document.getElementById("resetFiltersBtn");
const totalCountBadge = document.getElementById("totalCountBadge");
const loadMoreSpinner = document.querySelector(".loader-spinner");

// Filter chips
const chipInStock = document.getElementById("filterInStock");
const chipDiscount = document.getElementById("filterDiscount");
const chipNew = document.getElementById("filterNew");
const sizeFilterSelect = document.getElementById("sizeFilterSelect");

// Modal Elements
const productModal = document.getElementById("productModal");
const modalCloseBtn = document.getElementById("modalCloseBtn");
const modalImg = document.getElementById("modalImg");
const modalBadges = document.getElementById("modalBadges");
const modalArticle = document.getElementById("modalArticle");
const copyArtBtn = document.getElementById("copyArtBtn");
const modalTitle = document.getElementById("modalTitle");
const modalPrice = document.getElementById("modalPrice");
const modalOldPrice = document.getElementById("modalOldPrice");
const modalDiscountTag = document.getElementById("modalDiscountTag");
const modalSizesGrid = document.getElementById("modalSizesGrid");
const modalDescription = document.getElementById("modalDescription");
const btnOrderInBot = document.getElementById("btnOrderInBot");

// 1. Ініціалізація та завантаження каталогу
async function initApp() {
  try {
    const res = await fetch("catalog.json?v=" + Date.now());
    if (!res.ok) throw new Error("Не вдалося завантажити catalog.json");
    const data = await res.json();

    allCategories = data.categories || [];
    allProducts = data.products || [];
    if (data.bot_username) {
      botUsername = data.bot_username;
    }

    renderCategories();
    populateSizesFilter();
    applyFilters();
  } catch (err) {
    console.error("Помилка ініціалізації:", err);
    productsGrid.innerHTML = `
      <div style="grid-column: 1/-1; text-align: center; padding: 40px 10px;">
        <p style="color: #e91e63; font-weight: 700;">Помилка завантаження каталогу</p>
        <p style="font-size: 12px; color: var(--hint-color); margin-top: 6px;">Перевірте інтернет-з'єднання або спробуйте пізніше</p>
      </div>
    `;
  }
}

// 2. Рендер кнопок категорій
function renderCategories() {
  categoriesNav.innerHTML = "";
  allCategories.forEach((cat) => {
    const chip = document.createElement("button");
    chip.className = `cat-chip ${cat.id === activeCategoryId ? "active" : ""}`;
    chip.dataset.id = cat.id;
    chip.innerHTML = `
      <span>${cat.emoji || "🛍️"}</span>
      <span>${cat.name}</span>
      <span class="cat-count">(${cat.count})</span>
    `;
    chip.addEventListener("click", () => {
      if (activeCategoryId !== cat.id) {
        activeCategoryId = cat.id;
        document.querySelectorAll(".cat-chip").forEach((c) => c.classList.remove("active"));
        chip.classList.add("active");
        if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
        applyFilters();
      }
    });
    categoriesNav.appendChild(chip);
  });
}

// 3. Заповнення випадаючого списку розмірів
function populateSizesFilter() {
  const sizesSet = new Set();
  allProducts.forEach((p) => {
    if (p.sizes && Array.isArray(p.sizes)) {
      p.sizes.forEach((s) => {
        if (s.size && s.stock > 0) {
          sizesSet.add(s.size.trim());
        }
      });
    }
  });

  const sortedSizes = Array.from(sizesSet).sort((a, b) => {
    const numA = parseInt(a);
    const numB = parseInt(b);
    if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
    return a.localeCompare(b);
  });

  sizeFilterSelect.innerHTML = `<option value="">📏 Всі розміри</option>`;
  sortedSizes.forEach((sz) => {
    const opt = document.createElement("option");
    opt.value = sz;
    opt.textContent = `р. ${sz}`;
    sizeFilterSelect.appendChild(opt);
  });
}

// 4. Фільтрація товарів
function applyFilters() {
  filteredProducts = allProducts.filter((p) => {
    // Категорія
    if (activeCategoryId !== 0 && p.category_id !== activeCategoryId) {
      return false;
    }

    // Тільки в наявності
    if (onlyInStock && (!p.total_stock || p.total_stock <= 0)) {
      return false;
    }

    // Тільки зі знижкою
    if (onlyDiscount && (!p.manual_discount || p.manual_discount <= 0)) {
      return false;
    }

    // Тільки новинки
    if (onlyNew && !p.is_new) {
      return false;
    }

    // Фільтр за конкретним розміром
    if (selectedSize) {
      const hasSize = (p.sizes || []).some(
        (s) => s.size && s.size.trim().toLowerCase() === selectedSize.toLowerCase() && s.stock > 0
      );
      if (!hasSize) return false;
    }

    // Пошуковий запит
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const inArt = (p.article || "").toLowerCase().includes(q);
      const inName = (p.name || "").toLowerCase().includes(q);
      const inDesc = (p.description || "").toLowerCase().includes(q);
      if (!inArt && !inName && !inDesc) return false;
    }

    return true;
  });

  totalCountBadge.textContent = `${filteredProducts.length} шт.`;
  productsGrid.innerHTML = "";
  displayedCount = 0;

  if (filteredProducts.length === 0) {
    emptyState.style.display = "block";
  } else {
    emptyState.style.display = "none";
    loadMoreProducts();
  }
}

// 5. Почергове підвантаження порцій карток (Lazy Loading)
function loadMoreProducts() {
  const nextBatch = filteredProducts.slice(displayedCount, displayedCount + BATCH_SIZE);
  if (nextBatch.length === 0) return;

  const fragment = document.createDocumentFragment();

  nextBatch.forEach((prod) => {
    const card = document.createElement("div");
    card.className = "product-card";

    // Бейджі
    let badgesHtml = "";
    if (prod.is_new) {
      badgesHtml += `<span class="badge badge-new">Новинка</span>`;
    }
    if (prod.manual_discount && prod.manual_discount > 0) {
      badgesHtml += `<span class="badge badge-discount">-${Math.round(prod.manual_discount)}%</span>`;
    }
    if (prod.total_stock <= 0) {
      badgesHtml += `<span class="badge badge-out">Немає</span>`;
    }

    // Ціна
    let oldPriceHtml = "";
    if (prod.manual_discount && prod.manual_discount > 0) {
      const oldP = Math.round(prod.price / (1 - prod.manual_discount / 100));
      oldPriceHtml = `<span class="card-old-price">${oldP} грн</span>`;
    }

    // Розміри
    let sizesHtml = "";
    if (prod.sizes && prod.sizes.length > 0) {
      const inStockSizes = prod.sizes.filter((s) => s.stock > 0);
      const displaySizes = inStockSizes.slice(0, 4);
      sizesHtml = displaySizes
        .map((s) => `<span class="size-pill in-stock">${s.size}</span>`)
        .join("");
      if (inStockSizes.length > 4) {
        sizesHtml += `<span class="size-pill">+${inStockSizes.length - 4}</span>`;
      }
    }

    const photoSrc = prod.photo || "placeholder.svg";

    card.innerHTML = `
      <div class="card-img-box">
        <div class="card-badges">${badgesHtml}</div>
        <img src="${photoSrc}" alt="${prod.name || prod.article}" loading="lazy" onerror="this.src='placeholder.svg'">
        <span class="card-art-tag">${prod.article || "—"}</span>
      </div>
      <div class="card-info">
        <div class="card-title">${prod.name || prod.article}</div>
        <div class="card-price-row">
          <span class="card-price">${Math.round(prod.price)} грн</span>
          ${oldPriceHtml}
        </div>
        <div class="card-sizes">${sizesHtml}</div>
      </div>
    `;

    card.addEventListener("click", () => openModal(prod));
    fragment.appendChild(card);
  });

  productsGrid.appendChild(fragment);
  displayedCount += nextBatch.length;
}

// 6. Нескінченний скрол
window.addEventListener("scroll", () => {
  if (displayedCount >= filteredProducts.length) return;
  const { scrollTop, scrollHeight, clientHeight } = document.documentElement;
  if (scrollTop + clientHeight >= scrollHeight - 400) {
    loadMoreProducts();
  }
});

// 7. Відкриття та закриття модального вікна
function openModal(prod) {
  currentModalProduct = prod;

  modalImg.src = prod.photo || "placeholder.svg";
  modalArticle.textContent = `Арт: ${prod.article || "—"}`;
  modalTitle.textContent = prod.name || prod.article;

  // Ціни
  modalPrice.textContent = `${Math.round(prod.price)} грн`;
  if (prod.manual_discount && prod.manual_discount > 0) {
    const oldP = Math.round(prod.price / (1 - prod.manual_discount / 100));
    modalOldPrice.textContent = `${oldP} грн`;
    modalOldPrice.style.display = "inline";
    modalDiscountTag.textContent = `Знижка -${Math.round(prod.manual_discount)}%`;
    modalDiscountTag.style.display = "inline";
  } else {
    modalOldPrice.style.display = "none";
    modalDiscountTag.style.display = "none";
  }

  // Розміри
  modalSizesGrid.innerHTML = "";
  if (prod.sizes && prod.sizes.length > 0) {
    prod.sizes.forEach((s) => {
      const item = document.createElement("div");
      const isOut = s.stock <= 0;
      item.className = `size-item-card ${isOut ? "out" : ""}`;
      item.innerHTML = `
        <span>р. ${s.size} ${s.color ? `(${s.color})` : ""}</span>
        <span class="size-stock-badge ${isOut ? "zero" : ""}">${isOut ? "Немає" : `${s.stock} шт.`}</span>
      `;
      modalSizesGrid.appendChild(item);
    });
  } else {
    modalSizesGrid.innerHTML = `<p style="font-size: 13px; color: var(--hint-color);">Розміри уточнюйте в боті</p>`;
  }

  // Опис
  if (prod.description) {
    modalDescription.textContent = prod.description;
    document.getElementById("modalDescSection").style.display = "block";
  } else {
    document.getElementById("modalDescSection").style.display = "none";
  }

  productModal.classList.add("open");
  document.body.style.overflow = "hidden";

  if (tg?.BackButton) tg.BackButton.show();
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("light");
}

function closeModal() {
  productModal.classList.remove("open");
  document.body.style.overflow = "";
  currentModalProduct = null;
  if (tg?.BackButton) tg.BackButton.hide();
}

modalCloseBtn.addEventListener("click", closeModal);
productModal.addEventListener("click", (e) => {
  if (e.target === productModal) closeModal();
});

// Копіювання артикулу
copyArtBtn.addEventListener("click", () => {
  if (!currentModalProduct || !currentModalProduct.article) return;
  navigator.clipboard.writeText(currentModalProduct.article).then(() => {
    copyArtBtn.textContent = "✅ Скопійовано!";
    if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred("success");
    setTimeout(() => {
      copyArtBtn.textContent = "📋 Копіювати";
    }, 1500);
  });
});

// Кнопка переходу в бот
btnOrderInBot.addEventListener("click", () => {
  if (!currentModalProduct) return;
  const startParam = currentModalProduct.id ? `prod_${currentModalProduct.id}` : `art_${currentModalProduct.article}`;
  
  if (tg?.HapticFeedback) tg.HapticFeedback.impactOccurred("medium");

  const targetBot = botUsername || "Clothesshopua_bot";
  const botLink = `https://t.me/${targetBot}?start=${startParam}`;

  // Якщо WebApp запущено всередині Telegram — переходимо в бота
  if (tg?.openTelegramLink) {
    tg.openTelegramLink(botLink);
    tg.close();
  } else {
    window.location.href = botLink;
  }
});

// 8. Слухачі пошуку та фільтрів
searchInput.addEventListener("input", (e) => {
  searchQuery = e.target.value.trim();
  searchClearBtn.style.display = searchQuery ? "flex" : "none";
  applyFilters();
});

searchClearBtn.addEventListener("click", () => {
  searchInput.value = "";
  searchQuery = "";
  searchClearBtn.style.display = "none";
  applyFilters();
  searchInput.focus();
});

chipInStock.addEventListener("click", () => {
  onlyInStock = !onlyInStock;
  chipInStock.classList.toggle("active", onlyInStock);
  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
  applyFilters();
});

chipDiscount.addEventListener("click", () => {
  onlyDiscount = !onlyDiscount;
  chipDiscount.classList.toggle("active", onlyDiscount);
  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
  applyFilters();
});

chipNew.addEventListener("click", () => {
  onlyNew = !onlyNew;
  chipNew.classList.toggle("active", onlyNew);
  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
  applyFilters();
});

sizeFilterSelect.addEventListener("change", (e) => {
  selectedSize = e.target.value;
  if (tg?.HapticFeedback) tg.HapticFeedback.selectionChanged();
  applyFilters();
});

resetFiltersBtn.addEventListener("click", () => {
  activeCategoryId = 0;
  searchQuery = "";
  onlyInStock = false;
  onlyDiscount = false;
  onlyNew = false;
  selectedSize = "";

  searchInput.value = "";
  searchClearBtn.style.display = "none";
  chipInStock.classList.remove("active");
  chipDiscount.classList.remove("active");
  chipNew.classList.remove("active");
  sizeFilterSelect.value = "";

  renderCategories();
  applyFilters();
});

// Запуск
document.addEventListener("DOMContentLoaded", initApp);
