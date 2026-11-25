// Логика страницы учёта оборудования

const STATUS_LABELS = {
  available: 'Свободно',
  in_use: 'В использовании',
};

// ---------- Работа с API ----------

// Запрос к серверу. При ошибке (400/404/409/500) бросает Error с текстом от сервера.
async function api(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || `Ошибка сервера (${response.status})`);
  }
  return data;
}

// ---------- Сообщения ----------

const messageEl = document.getElementById('message');

function showMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle('error', isError);
  messageEl.hidden = false;
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => (messageEl.hidden = true), 4000);
}

// ---------- Вспомогательные функции для таблиц ----------
// Данные вставляются через textContent (не innerHTML) — защита от XSS

function cell(text) {
  const td = document.createElement('td');
  td.textContent = text;
  return td;
}

function actionButton(text, ariaLabel, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = text;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', onClick);
  return button;
}

function emptyRow(tbody, colspan, text) {
  const tr = document.createElement('tr');
  const td = cell(text);
  td.colSpan = colspan;
  tr.appendChild(td);
  tbody.appendChild(tr);
}

// ---------- Табы ----------

const tabs = document.querySelectorAll('[role="tab"]');

tabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    tabs.forEach((t) => {
      const selected = t === tab;
      t.setAttribute('aria-selected', String(selected));
      document.getElementById(t.getAttribute('aria-controls')).hidden = !selected;
    });
    if (tab.id === 'tab-loans') loadLoans();
    else loadEquipment();
  });
});

// ---------- Оборудование ----------

const filterType = document.getElementById('filterType');
const filterStatus = document.getElementById('filterStatus');
const equipmentBody = document.getElementById('equipmentBody');

async function loadTypes() {
  const types = await api('/api/equipment/types');
  const selected = filterType.value;

  filterType.length = 1; // оставить только «Все»
  const datalist = document.getElementById('typeList');
  datalist.textContent = '';

  for (const type of types) {
    filterType.add(new Option(type, type));
    datalist.appendChild(new Option(type));
  }
  filterType.value = types.includes(selected) ? selected : '';
}

async function loadEquipment() {
  try {
    const params = new URLSearchParams();
    if (filterType.value) params.set('type', filterType.value);
    if (filterStatus.value) params.set('status', filterStatus.value);

    const items = await api('/api/equipment?' + params);
    renderEquipment(items);
  } catch (err) {
    showMessage(err.message, true);
  }
}

function renderEquipment(items) {
  equipmentBody.textContent = '';
  if (items.length === 0) {
    emptyRow(equipmentBody, 5, 'Ничего не найдено');
    return;
  }

  for (const item of items) {
    const tr = document.createElement('tr');
    tr.append(cell(item.name), cell(item.type), cell(item.serial_number));

    const statusText = item.status === 'in_use'
      ? `${STATUS_LABELS.in_use} (${item.borrower})`
      : STATUS_LABELS.available;
    const statusCell = cell(statusText);
    statusCell.className = 'status-' + item.status;
    tr.appendChild(statusCell);

    const actions = document.createElement('td');
    if (item.status === 'available') {
      actions.appendChild(actionButton('Выдать', `Выдать: ${item.name}`, () => openLoanDialog(item)));
    } else {
      actions.appendChild(actionButton('Вернуть', `Вернуть: ${item.name}`, () => returnLoan(item.loan_id)));
    }
    actions.appendChild(actionButton('Изменить', `Изменить: ${item.name}`, () => openEquipmentDialog(item)));
    actions.appendChild(actionButton('Удалить', `Удалить: ${item.name}`, () => deleteEquipment(item)));
    tr.appendChild(actions);

    equipmentBody.appendChild(tr);
  }
}

async function deleteEquipment(item) {
  if (!confirm(`Удалить «${item.name}»?`)) return;
  try {
    await api('/api/equipment/' + item.id, { method: 'DELETE' });
    showMessage('Оборудование удалено');
    await loadTypes();
    loadEquipment();
  } catch (err) {
    showMessage(err.message, true);
  }
}

filterType.addEventListener('change', loadEquipment);
filterStatus.addEventListener('change', loadEquipment);

// ---------- Модальные окна ----------

// Кнопки «Отмена» закрывают своё окно
document.querySelectorAll('[data-close]').forEach((button) => {
  button.addEventListener('click', () => button.closest('dialog').close());
});

function setFormError(form, text) {
  form.querySelector('.form-error').textContent = text;
}

// Окно добавления / редактирования оборудования
const equipmentDialog = document.getElementById('equipmentDialog');
const equipmentForm = document.getElementById('equipmentForm');
let editingId = null; // null — добавление, число — редактирование

function openEquipmentDialog(item = null) {
  editingId = item ? item.id : null;
  equipmentForm.reset();
  setFormError(equipmentForm, '');
  document.getElementById('equipmentDialogTitle').textContent =
    item ? 'Изменить оборудование' : 'Добавить оборудование';

  if (item) {
    equipmentForm.elements.name.value = item.name;
    equipmentForm.elements.type.value = item.type;
    equipmentForm.elements.serial_number.value = item.serial_number;
  }
  equipmentDialog.showModal();
}

document.getElementById('addBtn').addEventListener('click', () => openEquipmentDialog());

equipmentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const body = {
    name: equipmentForm.elements.name.value.trim(),
    type: equipmentForm.elements.type.value.trim(),
    serial_number: equipmentForm.elements.serial_number.value.trim(),
  };

  // Проверка на клиенте (на сервере есть такая же)
  if (!body.name || !body.type || !body.serial_number) {
    setFormError(equipmentForm, 'Заполните все поля');
    return;
  }

  try {
    if (editingId) {
      await api('/api/equipment/' + editingId, { method: 'PUT', body: JSON.stringify(body) });
      showMessage('Изменения сохранены');
    } else {
      await api('/api/equipment', { method: 'POST', body: JSON.stringify(body) });
      showMessage('Оборудование добавлено');
    }
    equipmentDialog.close();
    await loadTypes();
    loadEquipment();
  } catch (err) {
    setFormError(equipmentForm, err.message);
  }
});

// Окно оформления выдачи
const loanDialog = document.getElementById('loanDialog');
const loanForm = document.getElementById('loanForm');
let loanEquipmentId = null;

function todayString() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

function openLoanDialog(item) {
  loanEquipmentId = item.id;
  loanForm.reset();
  setFormError(loanForm, '');
  document.getElementById('loanEquipmentName').textContent = `${item.name} (${item.serial_number})`;
  loanForm.elements.issue_date.value = todayString();
  loanDialog.showModal();
}

loanForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const borrower = loanForm.elements.borrower.value.trim();
  if (!borrower) {
    setFormError(loanForm, 'Укажите, кому выдаётся оборудование');
    return;
  }

  try {
    await api('/api/loans', {
      method: 'POST',
      body: JSON.stringify({
        equipment_id: loanEquipmentId,
        borrower,
        issue_date: loanForm.elements.issue_date.value,
      }),
    });
    loanDialog.close();
    showMessage('Выдача оформлена');
    loadEquipment();
  } catch (err) {
    setFormError(loanForm, err.message);
  }
});

// ---------- Выдачи ----------

const loansBody = document.getElementById('loansBody');

async function loadLoans() {
  try {
    const loans = await api('/api/loans');
    loansBody.textContent = '';
    if (loans.length === 0) {
      emptyRow(loansBody, 5, 'Активных выдач нет');
      return;
    }
    for (const loan of loans) {
      const tr = document.createElement('tr');
      tr.append(cell(loan.name), cell(loan.serial_number), cell(loan.borrower), cell(loan.issue_date));
      const actions = document.createElement('td');
      actions.appendChild(actionButton('Вернуть', `Вернуть: ${loan.name}`, () => returnLoan(loan.id)));
      tr.appendChild(actions);
      loansBody.appendChild(tr);
    }
  } catch (err) {
    showMessage(err.message, true);
  }
}

async function returnLoan(loanId) {
  try {
    await api(`/api/loans/${loanId}/return`, { method: 'POST' });
    showMessage('Оборудование возвращено');
    loadEquipment();
    loadLoans();
  } catch (err) {
    showMessage(err.message, true);
  }
}

// ---------- Старт ----------

loadTypes().then(loadEquipment).catch((err) => showMessage(err.message, true));
