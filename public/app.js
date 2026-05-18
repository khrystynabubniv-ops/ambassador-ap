const state = {
  activities: [],
  bonusThreshold: 3,
  bonusCoins: 10
};

const form = document.querySelector("#activity-form");
const activityContainer = document.querySelector("#activities");
const template = document.querySelector("#activity-template");
const monthSelect = document.querySelector("#month");
const addButton = document.querySelector("#add-activity");
const subtotalEl = document.querySelector("#subtotal");
const activityCountEl = document.querySelector("#activity-count");
const bonusEl = document.querySelector("#bonus");
const totalEl = document.querySelector("#total");
const resultEl = document.querySelector("#result");

init().catch((error) => showResult(error.message, true));

async function init() {
  const params = new URLSearchParams(window.location.search);
  const response = await fetch("/api/form-config");
  if (!response.ok) throw new Error("Could not load form configuration.");
  const config = await response.json();

  state.activities = config.activities;
  state.bonusThreshold = config.bonusThreshold;
  state.bonusCoins = config.bonusCoins;

  monthSelect.innerHTML = config.months
    .map((month) => `<option value="${month}">${month}</option>`)
    .join("");
  if (params.get("month")) {
    monthSelect.value = params.get("month");
  } else {
    monthSelect.value = config.currentMonth;
  }

  addActivityRow();
  addButton.addEventListener("click", addActivityRow);
  form.addEventListener("submit", submitForm);
  lucide.createIcons();
}

function addActivityRow() {
  const node = template.content.firstElementChild.cloneNode(true);
  const select = node.querySelector(".activity-select");
  select.innerHTML = [
    '<option value="" disabled selected>Обери активність</option>',
    ...state.activities.map((activity) => `<option value="${activity.key}">${activity.title}</option>`)
  ]
    .join("");

  node.querySelector(".remove-activity").addEventListener("click", () => {
    if (activityContainer.children.length > 1) {
      node.remove();
      updateSummary();
    }
  });

  node.querySelectorAll("input, select, textarea").forEach((input) => {
    input.addEventListener("input", updateSummary);
    input.addEventListener("change", updateSummary);
  });

  activityContainer.append(node);
  updateSummary();
  lucide.createIcons();
}

function rowToActivity(row) {
  const activityKey = row.querySelector(".activity-select").value;
  const activity = state.activities.find((item) => item.key === activityKey);
  const quantityInput = row.querySelector(".quantity-input");
  if (!activity) return { activity, quantity: 0 };
  if (!activity.requiresQuantity) return { activity, quantity: 1 };

  const parsedQuantity = Number(quantityInput.value);
  const quantity = quantityInput.value !== "" && parsedQuantity > 0 ? parsedQuantity : 0;
  return { activity, quantity };
}

function updateSummary() {
  let subtotal = 0;
  const distinctActivities = new Set();

  activityContainer.querySelectorAll(".activity-row").forEach((row) => {
    const { activity, quantity } = rowToActivity(row);
    if (!activity) return;

    const quantityLabel = row.querySelector(".quantity-label");
    const quantityInput = row.querySelector(".quantity-input");
    quantityLabel.hidden = !activity.requiresQuantity;
    quantityInput.required = activity.requiresQuantity;
    if (!activity.requiresQuantity) {
      quantityInput.value = "1";
    }

    const proofInput = row.querySelector(".proof-input");
    proofInput.required = Boolean(activity.requiresProof);

    const rowTotal = quantity * activity.coinsPerUnit;
    subtotal += rowTotal;
    if (quantity > 0) {
      distinctActivities.add(activity.key);
    }
    row.querySelector(".activity-rate").textContent = `${quantity} × ${activity.coinsPerUnit} coins`;
    row.querySelector(".activity-total").textContent = rowTotal;
  });

  const bonus = distinctActivities.size >= state.bonusThreshold ? state.bonusCoins : 0;
  subtotalEl.textContent = subtotal;
  activityCountEl.textContent = distinctActivities.size;
  bonusEl.textContent = bonus;
  totalEl.textContent = subtotal + bonus;
}

async function submitForm(event) {
  event.preventDefault();
  updateSummary();
  resultEl.hidden = true;

  const submitButton = form.querySelector('button[type="submit"]');
  submitButton.disabled = true;

  try {
    const formData = new FormData();
    formData.set("ambassadorName", form.ambassadorName.value.trim());
    formData.set("slackNickname", form.slackNickname.value.trim());
    formData.set("slackUserId", "");
    formData.set("month", form.month.value);

    const activities = [];
    activityContainer.querySelectorAll(".activity-row").forEach((row, index) => {
      const activityKey = row.querySelector(".activity-select").value;
      const activity = state.activities.find((item) => item.key === activityKey);
      const quantityInput = row.querySelector(".quantity-input");
      const quantity = activity?.requiresQuantity ? Number(quantityInput.value) : 1;
      activities.push({
        activityKey,
        quantity,
        notes: row.querySelector(".notes-input").value.trim()
      });

      for (const file of row.querySelector(".proof-input").files) {
        formData.append(`proof_${index}`, file);
      }
    });
    formData.set("activities", JSON.stringify(activities));

    const response = await fetch("/api/submissions", {
      method: "POST",
      body: formData
    });
    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || "Submission failed.");
    }

    showResult(
      [
        "Форму відправлено.",
        "",
        payload.summary.reportLine,
        `Base coins: ${payload.summary.baseCoins}`,
        `Bonus coins: ${payload.summary.bonusCoins}`,
        `Total coins: ${payload.summary.totalCoins}`
      ].join("\n")
    );
    form.reset();
    activityContainer.innerHTML = "";
    addActivityRow();
  } catch (error) {
    showResult(error.message, true);
  } finally {
    submitButton.disabled = false;
  }
}

function showResult(message, isError = false) {
  resultEl.hidden = false;
  resultEl.textContent = message;
  resultEl.style.color = isError ? "#b84d5a" : "#0d473a";
}
