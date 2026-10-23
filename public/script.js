// ---------- ELEMENTS ----------

const form = document.getElementById("memberForm");
const memberRows = document.getElementById("memberRows");
const memberSearch = document.getElementById("memberSearch");
const formModal = document.getElementById("formModal");

const assocForm = document.getElementById("associationForm");
const assocList = document.getElementById("associationNames");
const associationSearch = document.getElementById("associationSearch");
const assocFormModal = document.getElementById("assocFormModal");
const executiveRows = document.getElementById("executiveRows");

const fundForm = document.getElementById("fundForm");
const weekCards = document.getElementById("weekCards");
const fundSearch = document.getElementById("fundSearch");
const fundFormModal = document.getElementById("fundFormModal");

const sidebar = document.getElementById("sidebar");
const sidebarOverlay = document.getElementById("sidebarOverlay");

// Each pop-up is in one of three modes: "add", "view" or "edit"
let memberMode = "add";
let assocMode = "add";
let fundMode = "add";

// The item that is open in each pop-up
let currentMemberIndex = null;
let currentAssocIndex = null;
let currentFundIndex = null;

// ---------- SMALL HELPERS ----------

// Make text safe to put inside HTML
function safe(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// 1 -> 1st, 2 -> 2nd, 3 -> 3rd ...
function ordinal(n) {
  const last2 = n % 100;
  if (last2 >= 11 && last2 <= 13) return n + "th";
  const last = n % 10;
  if (last === 1) return n + "st";
  if (last === 2) return n + "nd";
  if (last === 3) return n + "rd";
  return n + "th";
}

// Turn "2026-10-19" into a date at midnight, local time
function parseDate(str) {
  const p = str.split("-");
  return new Date(p[0], p[1] - 1, p[2]);
}

// Turn a date into "2026-10-19"
function dateKey(d) {
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + month + "-" + day;
}

function shortDate(d) {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

// Tidy up a name for display: "sunday 1 mass" -> "Sunday 1st Mass"
// Words that already have capital letters (like "SVD") are left alone.
function niceTitle(text) {
  const words = String(text).trim().split(/\s+/);
  return words.map(function (word, i) {
    if (/^\d{1,2}$/.test(word) && i < words.length - 1) {
      return ordinal(Number(word)); // a small number followed by a word
    }
    if (word === word.toLowerCase()) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }).join(" ");
}

// Full amount with commas, like GH₵ 1,345.00
function money(n) {
  return "GH₵ " + n.toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  });
}

// Short amount for the graph, like GH₵ 5K or GH₵ 1.3M
function shortMoney(n) {
  if (n >= 1000000) {
    return "GH₵ " + (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  }
  if (n >= 1000) {
    return "GH₵ " + (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
  }
  return "GH₵ " + (n % 1 === 0 ? n : n.toFixed(2));
}

// The Monday of the week that a date falls in
function weekStart(d) {
  const start = new Date(d);
  start.setHours(0, 0, 0, 0);
  const day = start.getDay(); // 0 = Sunday
  const back = day === 0 ? 6 : day - 1;
  start.setDate(start.getDate() - back);
  return start;
}

// A member's full name. Older records only have "name", so fall back to that.
function fullName(m) {
  const joined = [m.firstName, m.middleName, m.surName].filter(Boolean).join(" ");
  return joined || m.name || "";
}

// The round picture with a letter, then a name and a small line under it
function headerHtml(title, subtitle) {
  return (
    '<div class="profile-top">' +
      '<div class="avatar">' + safe(title.charAt(0).toUpperCase()) + "</div>" +
      "<div><h2>" + safe(title) + '</h2><p class="profile-status">' + safe(subtitle) + "</p></div>" +
    "</div>"
  );
}

// Association header: avatar + name on the left, total count badge on the right
function assocHeaderHtml(a) {
  const total = (a.males + a.females).toLocaleString("en-GB");
  return (
    '<div class="profile-top assoc-top">' +
      '<div class="profile-id">' +
        '<div class="avatar">' + safe(a.name.charAt(0).toUpperCase()) + "</div>" +
        "<h2>" + safe(a.name) + "</h2>" +
      "</div>" +
      '<span class="count-badge">' + total + " members</span>" +
    "</div>"
  );
}

// Show a pop-up and always start at the top of it
function openModal(modal) {
  modal.classList.remove("hidden");
  modal.querySelector(".modal-box").scrollTop = 0;
}

// The "Are you sure?" pop-up with Yes and No.
// If the answer is Yes, the function we pass in is run.
const confirmModal = document.getElementById("confirmModal");
let confirmAction = null;

function askDelete(message, onYes) {
  document.getElementById("confirmText").textContent = message;
  confirmAction = onYes;
  confirmModal.classList.remove("hidden");
}

document.getElementById("confirmYes").addEventListener("click", function () {
  confirmModal.classList.add("hidden");
  const action = confirmAction;
  confirmAction = null;
  if (action) {
    action();
  }
});

document.getElementById("confirmNo").addEventListener("click", function () {
  confirmModal.classList.add("hidden");
  confirmAction = null;
});

// ---------- MEMBERS ----------

// Every field in the member form (the id is also the name we save it under)
const memberFields = [
  "membershipNumber", "firstName", "middleName", "surName", "dob", "gender", "pob", "homeTown",
  "father", "mother", "status",
  "association", "leadership",
  "baptised", "baptismDate", "baptismBy", "baptismPlace", "baptismGod",
  "communion", "firstcommunionDate", "firstCommunionBy", "firstcommunionPlace",
  "confirmed", "confirmationDate", "confirmationBy", "confirmationPlace", "confirmationGod",
  "married", "spouse", "marriageDate", "marriagePlace", "marriageBy",
  "transferred", "transferParish", "transferDate"
];

// Yes/No dropdowns and the extra fields they show
const toggles = [
  ["baptised", "baptismDetails"],
  ["communion", "firstCommunionDetails"],
  ["confirmed", "confirmationDetails"],
  ["married", "marriageDetails"],
  ["transferred", "transferDetails"]
];

function updateToggles() {
  toggles.forEach(function (t) {
    const answer = document.getElementById(t[0]).value;
    document.getElementById(t[1]).classList.toggle("hidden", answer !== "Yes");
  });
}

toggles.forEach(function (t) {
  document.getElementById(t[0]).addEventListener("change", updateToggles);
});

// ---------- TALKING TO THE SERVER ----------

// The lists are loaded from the server and kept here while the page is open
let membersCache = [];
let associationsCache = [];
let offeringsCache = [];

// Send a request to the server and give back its answer
async function api(method, url, body) {
  const options = { method: method, headers: {} };
  if (body !== undefined) {
    options.headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }

  let response;
  try {
    response = await fetch(url, options);
  } catch (e) {
    throw new Error("Could not reach the server. Make sure it is running (node server.js).");
  }

  // Not logged in (or the session ran out): go to the login page
  if (response.status === 401) {
    window.location.href = "/login";
    return new Promise(function () {});
  }

  let data = {};
  try {
    data = await response.json();
  } catch (e) {
    // some answers have no body
  }

  if (!response.ok) {
    throw new Error(data.error || "Something went wrong.");
  }
  return data;
}

async function loadMembers() {
  membersCache = await api("GET", "/api/members");
  showMembers();
}

async function loadAssociations() {
  associationsCache = await api("GET", "/api/associations");
  showAssociations();
}

async function loadOfferings() {
  offeringsCache = await api("GET", "/api/offerings");
  showFunds();
}

// Load everything when the page opens
async function loadAll() {
  try {
    const results = await Promise.all([
      api("GET", "/api/members"),
      api("GET", "/api/associations"),
      api("GET", "/api/offerings")
    ]);
    membersCache = results[0];
    associationsCache = results[1];
    offeringsCache = results[2];
    showMembers();
    showAssociations();
    showFunds();
  } catch (err) {
    alert(err.message);
  }
}

function getMembers() {
  return membersCache;
}

// Update the total, active and inactive numbers on Home
function updateStats() {
  const members = getMembers();
  const active = members.filter(function (m) {
    return (m.status || "Active") === "Active";
  }).length;

  document.getElementById("statTotal").textContent = members.length;
  document.getElementById("statActive").textContent = active;
  document.getElementById("statInactive").textContent = members.length - active;
}

// Show the members in the table, filtered by the search box
function showMembers() {
  const members = getMembers();
  const query = memberSearch.value.trim().toLowerCase();
  memberRows.innerHTML = "";

  let shown = 0;
  members.forEach(function (m, index) {
    const number = m.membershipNumber || "";
    const searchText = (number + " " + fullName(m)).toLowerCase();

    if (query !== "" && searchText.indexOf(query) === -1) {
      return;
    }

    const status = m.status || "Active";
    const pillClass = status === "Active" ? "pill-active" : "pill-inactive";

    const row = document.createElement("tr");
    row.dataset.index = index;
    row.innerHTML =
      "<td>" + safe(number || "-") + "</td>" +
      "<td>" + safe(fullName(m)) + "</td>" +
      "<td>" + safe(m.association || "-") + "</td>" +
      '<td><span class="pill ' + pillClass + '">' + safe(status) + "</span></td>";
    memberRows.appendChild(row);
    shown++;
  });

  if (members.length === 0) {
    memberRows.innerHTML =
      '<tr class="empty-row"><td colspan="4">No members yet. Click ADD to add one.</td></tr>';
  } else if (shown === 0) {
    memberRows.innerHTML =
      '<tr class="empty-row"><td colspan="4">No member found.</td></tr>';
  }

  updateStats();
  showSummary();
}

memberSearch.addEventListener("input", showMembers);

// The Summary page: counts of members
function showSummary() {
  const members = getMembers();
  const total = members.length;

  function count(test) {
    return members.filter(test).length;
  }

  const males = count(function (m) { return m.gender === "Male"; });
  const females = count(function (m) { return m.gender === "Female"; });

  const boxes = [
    ["Males", males],
    ["Females", females],
    ["Baptised", count(function (m) { return m.baptised === "Yes"; })],
    ["Communicants", count(function (m) { return m.communion === "Yes"; })],
    ["Confirmed", count(function (m) { return m.confirmed === "Yes"; })],
    ["Married", count(function (m) { return m.married === "Yes"; })],
    ["Not in any association", count(function (m) { return !m.association; })],
    ["Transferred from other parishes", count(function (m) { return m.transferred === "Yes"; })]
  ];

  // Older members were saved before the gender field existed
  if (males + females < total) {
    boxes.push(["Gender not recorded", total - males - females]);
  }

  const holder = document.getElementById("summaryBoxes");
  holder.innerHTML = "";
  boxes.forEach(function (b) {
    const box = document.createElement("div");
    box.className = "summary-box";
    box.innerHTML =
      '<span class="summary-label">' + b[0] + "</span>" +
      '<span class="summary-amount">' + b[1] + "</span>" +
      '<span class="summary-week">out of ' + total + " members</span>";
    holder.appendChild(box);
  });
}

// Fill the association dropdown with the associations that were added
function fillAssociationOptions(current) {
  const select = document.getElementById("association");
  const names = getAssociations().map(function (a) { return a.name; });

  // Keep the member's saved association even if it was deleted since
  if (current && names.indexOf(current) === -1) {
    names.push(current);
  }

  select.innerHTML = '<option value="">None</option>';
  names.forEach(function (n) {
    const option = document.createElement("option");
    option.value = n;
    option.textContent = n;
    select.appendChild(option);
  });

  select.value = current || "";
}

// Switch the member pop-up between add, view and edit
function setMemberMode(mode) {
  memberMode = mode;
  document.getElementById("memberFieldset").disabled = (mode === "view");
  document.getElementById("memberAddActions").classList.toggle("hidden", mode !== "add");
  document.getElementById("memberViewActions").classList.toggle("hidden", mode === "add");
  document.getElementById("saveMemberBtn").disabled = (mode !== "edit");
  document.getElementById("editMemberBtn").disabled = (mode === "edit");
  document.getElementById("memberFormTitle").classList.toggle("hidden", mode !== "add");
  document.getElementById("memberHeader").classList.toggle("hidden", mode === "add");
  formModal.classList.toggle("view-mode", mode === "view");
}

// Open the pop-up to add a new member
function openMemberForm() {
  form.reset();
  currentMemberIndex = null;
  fillAssociationOptions("");
  updateToggles();
  setMemberMode("add");
  openModal(formModal);
}

// Open a member's profile (read-only until Edit is clicked)
function openMemberView(index) {
  const m = getMembers()[index];
  currentMemberIndex = index;

  form.reset();
  fillAssociationOptions(m.association);
  memberFields.forEach(function (id) {
    const box = document.getElementById(id);
    box.value = m[id] || box.value;
  });

  // Older records saved one "name" only, so show it in First Name
  if (!m.firstName && m.name) {
    document.getElementById("firstName").value = m.name;
  }

  document.getElementById("memberHeader").innerHTML = headerHtml(fullName(m), m.status || "Active");
  updateToggles();
  setMemberMode("view");
  openModal(formModal);
}

document.getElementById("addMemberBtn").addEventListener("click", openMemberForm);

document.getElementById("closeForm").addEventListener("click", function () {
  formModal.classList.add("hidden");
});

// Click a row to open the profile
memberRows.addEventListener("click", function (e) {
  const row = e.target.closest("tr");
  if (row && row.dataset.index !== undefined) {
    openMemberView(row.dataset.index);
  }
});

// Edit button: unlock the fields
document.getElementById("editMemberBtn").addEventListener("click", function () {
  setMemberMode("edit");
});

// Save a new member, or save the changes to an existing one
form.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (memberMode === "view") {
    return;
  }

  const member = {};
  memberFields.forEach(function (id) {
    member[id] = document.getElementById(id).value;
  });
  member.membershipNumber = member.membershipNumber.trim();

  const members = getMembers();
  const skip = memberMode === "edit" ? Number(currentMemberIndex) : -1;

  // A membership number can only belong to one member
  const duplicate = members.some(function (other, i) {
    return i !== skip &&
      (other.membershipNumber || "").trim().toLowerCase() === member.membershipNumber.toLowerCase();
  });

  if (duplicate) {
    alert("Another member already has this membership number.");
    return;
  }

  try {
    if (memberMode === "edit") {
      const id = members[currentMemberIndex].id;
      await api("PUT", "/api/members/" + id, member);
      await loadMembers();
      openMemberView(membersCache.findIndex(function (m) { return m.id === id; })); // back to the read-only profile
    } else {
      await api("POST", "/api/members", member);
      await loadMembers();
      formModal.classList.add("hidden");
    }
  } catch (err) {
    alert(err.message);
  }
});

// Delete the member whose profile is open
document.getElementById("deleteMemberBtn").addEventListener("click", function () {
  askDelete("Are you sure you want to delete this member?", async function () {
    try {
      await api("DELETE", "/api/members/" + getMembers()[currentMemberIndex].id);
      formModal.classList.add("hidden");
      await loadMembers();
    } catch (err) {
      alert(err.message);
    }
  });
});

// ---------- ASSOCIATIONS ----------

function getAssociations() {
  return associationsCache;
}

// Add one executive row to the form and give it back
function addExecRow(canRemove) {
  const row = document.createElement("div");
  row.className = "exec-row";
  row.innerHTML =
    '<div class="field-grid">' +
      '<label>Name <input type="text" class="exec-name" required></label>' +
      '<label>Title <input type="text" class="exec-title" placeholder="e.g. President"></label>' +
      '<label>Phone Number <input type="tel" class="exec-phone" required></label>' +
      '<label>Email <input type="email" class="exec-email"></label>' +
    "</div>";

  if (canRemove) {
    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-btn";
    remove.textContent = "Remove this executive";
    remove.addEventListener("click", function () {
      row.remove();
    });
    row.appendChild(remove);
  }

  executiveRows.appendChild(row);
  return row;
}

// Clear the executives and start again with one row
function resetExecRows() {
  executiveRows.innerHTML = "";
  addExecRow(false);
}

// Show the association names, filtered by the search box
function showAssociations() {
  const associations = getAssociations();
  const query = associationSearch.value.trim().toLowerCase();
  assocList.innerHTML = "";

  let shown = 0;
  associations.forEach(function (a, index) {
    if (query !== "" && a.name.toLowerCase().indexOf(query) === -1) {
      return;
    }

    const total = a.males + a.females;
    const li = document.createElement("li");
    li.dataset.index = index;
    li.innerHTML =
      '<span class="assoc-name">' + safe(a.name) + "</span>" +
      '<span class="list-date">' + total.toLocaleString("en-GB") + " members</span>";
    assocList.appendChild(li);
    shown++;
  });

  if (associations.length === 0) {
    assocList.innerHTML = '<li class="empty">No associations yet. Click ADD to add one.</li>';
  } else if (shown === 0) {
    assocList.innerHTML = '<li class="empty">No association found.</li>';
  }
}

associationSearch.addEventListener("input", showAssociations);

// Switch the association pop-up between add, view and edit
function setAssocMode(mode) {
  assocMode = mode;
  document.getElementById("assocFieldset").disabled = (mode === "view");
  document.getElementById("assocAddActions").classList.toggle("hidden", mode !== "add");
  document.getElementById("assocViewActions").classList.toggle("hidden", mode === "add");
  document.getElementById("saveAssocBtn").disabled = (mode !== "edit");
  document.getElementById("editAssocBtn").disabled = (mode === "edit");
  document.getElementById("assocFormTitle").classList.toggle("hidden", mode !== "add");
  document.getElementById("assocHeader").classList.toggle("hidden", mode === "add");
  assocFormModal.classList.toggle("view-mode", mode === "view");
}

// Open the pop-up to add a new association
function openAssocForm() {
  assocForm.reset();
  currentAssocIndex = null;
  resetExecRows();
  setAssocMode("add");
  openModal(assocFormModal);
}

// Open an association's details (read-only until Edit is clicked)
function openAssocView(index) {
  const a = getAssociations()[index];
  currentAssocIndex = index;

  assocForm.reset();
  document.getElementById("assocName").value = a.name;
  document.getElementById("assocMales").value = a.males;
  document.getElementById("assocFemales").value = a.females;

  executiveRows.innerHTML = "";
  a.executives.forEach(function (ex, i) {
    const row = addExecRow(i > 0);
    row.querySelector(".exec-name").value = ex.name;
    row.querySelector(".exec-title").value = ex.title || ""; // older records have no title
    row.querySelector(".exec-phone").value = ex.phone;
    row.querySelector(".exec-email").value = ex.email;
  });

  document.getElementById("assocHeader").innerHTML = assocHeaderHtml(a);
  setAssocMode("view");
  openModal(assocFormModal);
}

document.getElementById("addAssociationBtn").addEventListener("click", openAssocForm);

document.getElementById("closeAssocForm").addEventListener("click", function () {
  assocFormModal.classList.add("hidden");
});

document.getElementById("addExecBtn").addEventListener("click", function () {
  addExecRow(true);
});

// Click a name to open the details
assocList.addEventListener("click", function (e) {
  const li = e.target.closest("li");
  if (li && li.dataset.index !== undefined) {
    openAssocView(li.dataset.index);
  }
});

// Edit button: unlock the fields
document.getElementById("editAssocBtn").addEventListener("click", function () {
  setAssocMode("edit");
});

// Save a new association, or save the changes to an existing one
assocForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (assocMode === "view") {
    return;
  }

  const executives = [];
  document.querySelectorAll("#executiveRows .exec-row").forEach(function (row) {
    executives.push({
      name: row.querySelector(".exec-name").value,
      title: row.querySelector(".exec-title").value,
      phone: row.querySelector(".exec-phone").value,
      email: row.querySelector(".exec-email").value
    });
  });

  const association = {
    name: document.getElementById("assocName").value,
    males: Number(document.getElementById("assocMales").value),
    females: Number(document.getElementById("assocFemales").value),
    executives: executives
  };

  try {
    if (assocMode === "edit") {
      const id = getAssociations()[currentAssocIndex].id;
      await api("PUT", "/api/associations/" + id, association);
      await loadAssociations();
      await loadMembers(); // a renamed association also updates its members
      openAssocView(associationsCache.findIndex(function (a) { return a.id === id; })); // back to the read-only details
    } else {
      await api("POST", "/api/associations", association);
      await loadAssociations();
      assocFormModal.classList.add("hidden");
    }
  } catch (err) {
    alert(err.message);
  }
});

// Delete the association that is open
document.getElementById("deleteAssocBtn").addEventListener("click", function () {
  askDelete("Are you sure you want to delete this association?", async function () {
    try {
      await api("DELETE", "/api/associations/" + getAssociations()[currentAssocIndex].id);
      assocFormModal.classList.add("hidden");
      await loadAssociations();
    } catch (err) {
      alert(err.message);
    }
  });
});

// ---------- FUNDS (OFFERINGS) ----------

function getOfferings() {
  return offeringsCache;
}

// One line in a list of offerings: name on the left, date and amount on the right
function offeringItem(o, index) {
  const date = parseDate(o.date).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric"
  });
  return (
    '<li data-index="' + index + '">' +
      '<span class="offering-name">' + safe(niceTitle(o.occasion || "Offering")) + "</span>" +
      '<span class="list-date">' + date + " · <strong>" + money(Number(o.amount)) + "</strong></span>" +
    "</li>"
  );
}

// Show the week cards, or the search results if something is typed in the search box
function showFunds() {
  const offerings = getOfferings();

  showOfferingChart();
  showAllTimeStats();

  // Searching: one list with the matching offerings
  const query = fundSearch.value.trim().toLowerCase();
  if (query !== "") {
    let items = "";
    let found = 0;

    offerings.forEach(function (o, index) {
      const text = ((o.occasion || "Offering") + " " + o.date + " " + o.amount).toLowerCase();
      if (text.indexOf(query) !== -1) {
        items += offeringItem(o, index);
        found++;
      }
    });

    if (found === 0) {
      items = '<li class="empty">No offering found.</li>';
    }

    weekCards.innerHTML =
      '<div class="card"><h2>Search Results</h2><ul class="name-list">' + items + "</ul></div>";
    return;
  }

  // Not searching: one card for each week, newest first
  const thisWeek = weekStart(new Date());

  // Always show this week and the 3 before it
  const groups = {};
  for (let i = 0; i < 4; i++) {
    const s = new Date(thisWeek);
    s.setDate(thisWeek.getDate() - 7 * i);
    groups[dateKey(s)] = [];
  }

  // Put each offering into its week (older weeks with offerings are shown too)
  offerings.forEach(function (o, index) {
    const key = dateKey(weekStart(parseDate(o.date)));
    if (!groups[key]) {
      groups[key] = [];
    }
    groups[key].push(index);
  });

  const lastWeek = new Date(thisWeek);
  lastWeek.setDate(thisWeek.getDate() - 7);

  weekCards.innerHTML = "";

  Object.keys(groups).sort().reverse().forEach(function (key) {
    const start = parseDate(key);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    let title = "Week of " + shortDate(start);
    if (key === dateKey(thisWeek)) title = "This week";
    if (key === dateKey(lastWeek)) title = "Last week";

    // Offerings in date order
    groups[key].sort(function (a, b) {
      if (offerings[a].date < offerings[b].date) return -1;
      if (offerings[a].date > offerings[b].date) return 1;
      return 0;
    });

    let total = 0;
    let items = "";
    groups[key].forEach(function (index) {
      total += Number(offerings[index].amount);
      items += offeringItem(offerings[index], index);
    });

    if (items === "") {
      items = '<li class="empty">No offerings this week yet.</li>';
    }

    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML =
      '<div class="week-head">' +
        "<div><h2>" + title + '</h2><span class="week-range">' + shortDate(start) + " - " + shortDate(end) + "</span></div>" +
        '<div class="week-total">' + money(total) + "</div>" +
        '<button type="button" class="add-btn week-add" data-week="' + key + '">+ Add Mass</button>' +
      "</div>" +
      '<ul class="name-list">' + items + "</ul>";
    weekCards.appendChild(card);
  });
}

fundSearch.addEventListener("input", showFunds);

// The amount shows as "GH₵ 1,345.00" when viewing, and as a number box when adding or editing
function setAmountDisplay(formatted) {
  const box = document.getElementById("fundAmount");
  if (formatted) {
    box.type = "text";
    box.value = money(Number(box.dataset.raw));
  } else {
    box.type = "number";
    box.value = box.dataset.raw || "";
  }
}

// Switch the offering pop-up between add, view and edit
function setFundMode(mode) {
  fundMode = mode;
  document.getElementById("fundFieldset").disabled = (mode === "view");
  document.getElementById("fundAddActions").classList.toggle("hidden", mode !== "add");
  document.getElementById("fundViewActions").classList.toggle("hidden", mode === "add");
  document.getElementById("saveFundBtn").disabled = (mode !== "edit");
  document.getElementById("editFundBtn").disabled = (mode === "edit");
  document.getElementById("fundFormTitle").classList.toggle("hidden", mode !== "add");
  document.getElementById("fundHeader").classList.toggle("hidden", mode === "add");
  fundFormModal.classList.toggle("view-mode", mode === "view");
}

// Open the pop-up to add an offering.
// With a weekKey, the date can only be a day inside that week.
function openFundForm(weekKey) {
  fundForm.reset();
  currentFundIndex = null;
  document.getElementById("fundAmount").dataset.raw = "";
  setAmountDisplay(false);

  const dateBox = document.getElementById("fundDate");
  dateBox.min = "";
  dateBox.max = "";
  document.getElementById("fundFormTitle").textContent = "Add Offering";

  if (weekKey) {
    const start = parseDate(weekKey);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    dateBox.min = weekKey;
    dateBox.max = dateKey(end);

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    dateBox.value = (today >= start && today <= end) ? dateKey(today) : weekKey;

    document.getElementById("fundFormTitle").textContent =
      "Add Offering: " + shortDate(start) + " - " + shortDate(end);
  }

  setFundMode("add");
  openModal(fundFormModal);
}

// Open an offering (read-only until Edit is clicked), with its ranking
function openFundView(index) {
  const offerings = getOfferings();
  const o = offerings[index];
  currentFundIndex = index;

  fundForm.reset();
  document.getElementById("fundOccasion").value = o.occasion || "";
  document.getElementById("fundDate").value = o.date;
  document.getElementById("fundAmount").dataset.raw = o.amount;

  const dateBox = document.getElementById("fundDate");
  dateBox.min = "";
  dateBox.max = "";

  const amount = Number(o.amount);
  const higher = offerings.filter(function (x) {
    return Number(x.amount) > amount;
  }).length;

  document.getElementById("fundHeader").innerHTML =
    headerHtml(niceTitle(o.occasion || "Offering"),
      "Ranking: " + ordinal(higher + 1) + " highest out of " + offerings.length);

  setFundMode("view");
  setAmountDisplay(true);
  openModal(fundFormModal);
}

document.getElementById("addFundBtn").addEventListener("click", function () {
  openFundForm();
});

document.getElementById("closeFundForm").addEventListener("click", function () {
  fundFormModal.classList.add("hidden");
});

// Click a week's ADD button, or click an offering to open it
weekCards.addEventListener("click", function (e) {
  const addBtn = e.target.closest(".week-add");
  if (addBtn) {
    openFundForm(addBtn.dataset.week);
    return;
  }

  const li = e.target.closest("li");
  if (li && li.dataset.index !== undefined) {
    openFundView(li.dataset.index);
  }
});

// Edit button: unlock the fields
document.getElementById("editFundBtn").addEventListener("click", function () {
  setAmountDisplay(false);
  setFundMode("edit");
});

// Save a new offering, or save the changes to an existing one
fundForm.addEventListener("submit", async function (e) {
  e.preventDefault();

  if (fundMode === "view") {
    return;
  }

  const record = {
    occasion: document.getElementById("fundOccasion").value,
    date: document.getElementById("fundDate").value,
    amount: document.getElementById("fundAmount").value
  };

  try {
    if (fundMode === "edit") {
      const id = getOfferings()[currentFundIndex].id;
      await api("PUT", "/api/offerings/" + id, record);
      await loadOfferings();
      openFundView(offeringsCache.findIndex(function (o) { return o.id === id; })); // back to the read-only view
    } else {
      await api("POST", "/api/offerings", record);
      await loadOfferings();
      fundFormModal.classList.add("hidden");
    }
  } catch (err) {
    alert(err.message);
  }
});

// Delete the offering that is open
document.getElementById("deleteFundBtn").addEventListener("click", function () {
  askDelete("Are you sure you want to delete this offering?", async function () {
    try {
      await api("DELETE", "/api/offerings/" + getOfferings()[currentFundIndex].id);
      fundFormModal.classList.add("hidden");
      await loadOfferings();
    } catch (err) {
      alert(err.message);
    }
  });
});

// ---------- HOME: OFFERINGS ----------

// Add up all offerings between two dates (both included)
function totalBetween(offerings, start, end) {
  let total = 0;
  offerings.forEach(function (o) {
    const d = parseDate(o.date);
    if (d >= start && d <= end) {
      total += Number(o.amount);
    }
  });
  return total;
}

// Graph comparing the last 4 weeks (this week and the 3 before it)
function showOfferingChart() {
  const offerings = getOfferings();
  const thisWeek = weekStart(new Date());

  const weeks = [];
  for (let i = 3; i >= 0; i--) {
    const start = new Date(thisWeek);
    start.setDate(thisWeek.getDate() - 7 * i);
    const end = new Date(start);
    end.setDate(start.getDate() + 6);

    let label = shortDate(start) + " - " + shortDate(end);
    if (i === 0) {
      label += " (this week)";
    }
    weeks.push({ label: label, total: totalBetween(offerings, start, end) });
  }

  const biggest = Math.max.apply(null, weeks.map(function (w) { return w.total; })) || 1;

  const chart = document.getElementById("offeringChart");
  chart.innerHTML = "";

  weeks.forEach(function (w) {
    const percent = (w.total / biggest) * 100;

    const col = document.createElement("div");
    col.className = "bar-col";
    col.title = w.label + ": " + money(w.total); // exact amount on hover
    col.innerHTML =
      '<span class="bar-value">' + shortMoney(w.total) + "</span>" +
      '<div class="bar-area"><div class="bar" style="height:' + percent + '%"></div></div>' +
      '<span class="bar-label">' + w.label + "</span>";
    chart.appendChild(col);
  });
}

// Highest, average and lowest offering of all time
function showAllTimeStats() {
  const offerings = getOfferings();

  if (offerings.length === 0) {
    document.getElementById("allHigh").textContent = money(0);
    document.getElementById("allAvg").textContent = money(0);
    document.getElementById("allLow").textContent = money(0);
    document.getElementById("allHighInfo").textContent = "No offerings yet";
    document.getElementById("allAvgInfo").textContent = "No offerings yet";
    document.getElementById("allLowInfo").textContent = "No offerings yet";
    return;
  }

  let highest = offerings[0];
  let lowest = offerings[0];
  let sum = 0;

  offerings.forEach(function (o) {
    const amount = Number(o.amount);
    sum += amount;
    if (amount > Number(highest.amount)) highest = o;
    if (amount < Number(lowest.amount)) lowest = o;
  });

  document.getElementById("allHigh").textContent = money(Number(highest.amount));
  document.getElementById("allHighInfo").textContent = niceTitle(highest.occasion || "Offering") + " · " + highest.date;

  document.getElementById("allAvg").textContent = money(sum / offerings.length);
  document.getElementById("allAvgInfo").textContent = "Per offering, out of " + offerings.length;

  document.getElementById("allLow").textContent = money(Number(lowest.amount));
  document.getElementById("allLowInfo").textContent = niceTitle(lowest.occasion || "Offering") + " · " + lowest.date;
}

// ---------- CLOSE POP-UPS BY CLICKING OUTSIDE ----------

[formModal, assocFormModal, fundFormModal, confirmModal].forEach(function (modal) {
  modal.addEventListener("click", function (e) {
    if (e.target === modal) {
      modal.classList.add("hidden");
    }
  });
});

// ---------- MOBILE MENU ----------

function closeMenu() {
  if (sidebar) sidebar.classList.remove("open");
  if (sidebarOverlay) sidebarOverlay.classList.remove("show");
}

const menuBtn = document.getElementById("menuBtn");

if (menuBtn && sidebar && sidebarOverlay) {
  menuBtn.addEventListener("click", function () {
    sidebar.classList.toggle("open");
    sidebarOverlay.classList.toggle("show");
  });

  sidebarOverlay.addEventListener("click", closeMenu);
}

// ---------- SIDEBAR NAVIGATION ----------

const navLinks = document.querySelectorAll(".nav-link");
const pages = document.querySelectorAll(".page");

navLinks.forEach(function (link) {
  link.addEventListener("click", function (e) {
    e.preventDefault();

    navLinks.forEach(function (l) { l.classList.remove("active"); });
    link.classList.add("active");

    pages.forEach(function (p) { p.classList.add("hidden"); });
    document.getElementById(link.dataset.page).classList.remove("hidden");

    closeMenu(); // on a phone, close the menu after choosing a page
  });
});

// ---------- LOG OUT ----------

document.getElementById("logoutLink").addEventListener("click", async function (e) {
  e.preventDefault();
  try {
    await fetch("/logout", { method: "POST" });
  } catch (err) {
    // go to the login page anyway
  }
  window.location.href = "/login";
});

// ---------- START ----------

resetExecRows();
loadAll();
