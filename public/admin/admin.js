const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("w2e_admin_token") || "";


/* =========================
   MESSAGE
========================= */

function msg(el, text, ok = false) {
  if (!el) return;

  el.textContent = text || "";
  el.className = "msg " + (ok ? "ok" : "");
}


/* =========================
   API
========================= */

async function api(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = "Bearer " + token;
  }

  const response = await fetch(path, {
    ...options,
    headers
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error ||
      data.message ||
      "Request failed"
    );
  }

  return data;
}


/* =========================
   LOGIN / LOGOUT
========================= */

function showPanel() {
  if ($("loginBox")) $("loginBox").hidden = true;
  if ($("panel")) $("panel").hidden = false;

  loadAll();
}

function showLogin() {
  if ($("loginBox")) $("loginBox").hidden = false;
  if ($("panel")) $("panel").hidden = true;
}

async function login() {
  const username = $("adminUser")?.value.trim();
  const password = $("adminPass")?.value || "";

  if (!username || !password) {
    msg($("loginMsg"), "Username এবং password দিন।");
    return;
  }

  try {
    const data = await api("/api/admin/login", {
      method: "POST",
      body: JSON.stringify({
        username,
        password
      })
    });

    token = data.token;

    localStorage.setItem(
      "w2e_admin_token",
      token
    );

    msg(
      $("loginMsg"),
      "Login successful.",
      true
    );

    showPanel();

  } catch (error) {
    msg($("loginMsg"), error.message);
  }
}


/* =========================
   LOAD ALL
========================= */

async function loadAll() {

  /* =========================
     DASHBOARD
  ========================= */

  try {
    const data = await api("/api/admin/stats");

    if ($("sUsers"))
      $("sUsers").textContent = data.users ?? 0;

    if ($("sTasks"))
      $("sTasks").textContent = data.tasks ?? 0;

    if ($("sProofs"))
      $("sProofs").textContent =
        data.pendingProofs ?? 0;

    if ($("sWithdrawals"))
      $("sWithdrawals").textContent =
        data.pendingWithdrawals ?? 0;

  } catch (error) {
    msg($("status"), error.message);
  }


  /* =========================
     TASKS
  ========================= */

  try {
    const data = await api("/api/admin/tasks");

    const tasks = Array.isArray(data)
      ? data
      : [];

    if ($("tasks")) {

      $("tasks").innerHTML =
        tasks.map(task => {

          const taskId = Number(task.id);

          const active =
            task.active !== false;

          return `
            <div class="item">

              <b>
                ${escapeHTML(
                  task.title || "Untitled Task"
                )}
              </b>

              <p>
                ${escapeHTML(
                  task.description || ""
                )}
              </p>

              <p>
                Task ID:
                <strong>
                  #${Number.isInteger(taskId)
                    ? taskId
                    : "-"}
                </strong>
              </p>

              <p>
                Reward:
                <strong>
                  ৳${task.reward ?? 0}
                </strong>
              </p>

              <p>
                Status:
                <strong>
                  ${active ? "Active" : "Deleted"}
                </strong>
              </p>

              ${
                active && Number.isInteger(taskId)
                  ? `
                    <button
                      type="button"
                      onclick="deleteTask(${taskId})"
                      style="
                        background:#dc2626;
                        color:#fff;
                        border:0;
                        padding:9px 14px;
                        border-radius:7px;
                        cursor:pointer;
                        margin-top:8px;
                      "
                    >
                      🗑️ Delete Task
                    </button>
                  `
                  : ""
              }

            </div>
          `;

        }).join("") ||

        '<p class="muted">No tasks yet.</p>';
    }

  } catch (error) {

    if ($("tasks")) {
      $("tasks").innerHTML =
        `<p class="error">${escapeHTML(
          error.message
        )}</p>`;
    }
  }


  /* =========================
     USERS
  ========================= */

  try {
    const data = await api("/api/admin/users");

    const users = Array.isArray(data)
      ? data
      : [];

    if ($("users")) {

      $("users").innerHTML =
        users.map(user => `

          <div class="item">

            <b>
              ${escapeHTML(
                user.username || "Unknown User"
              )}
            </b>

            <p>
              Mobile:
              ${escapeHTML(
                user.mobile || "-"
              )}
            </p>

            <p>
              Email:
              ${escapeHTML(
                user.email || "-"
              )}
            </p>

            <p>
              Balance:
              <strong>
                ৳${user.balance ?? 0}
              </strong>
            </p>

            <p>
              Earned:
              ৳${user.total_earned ?? 0}
            </p>

            <p>
              Referrals:
              ${user.referrals ?? 0}
            </p>

          </div>

        `).join("") ||

        '<p class="muted">No users.</p>';
    }

  } catch (error) {

    if ($("users")) {
      $("users").innerHTML =
        `<p class="error">${escapeHTML(
          error.message
        )}</p>`;
    }
  }


  /* =========================
     PROOFS
  ========================= */

  try {
    const data = await api("/api/admin/proofs");

    const proofs = Array.isArray(data)
      ? data
      : [];

    if ($("proofs")) {

      $("proofs").innerHTML =
        proofs.map(proof => {

          const status =
            String(
              proof.status || ""
            ).toLowerCase();

          const proofValue =
            String(
              proof.proof || ""
            );

          let proofHTML = "";

          if (
            proofValue.startsWith("http://") ||
            proofValue.startsWith("https://")
          ) {

            proofHTML = `
              <p>
                Proof:
                <a
                  href="${escapeAttribute(
                    proofValue
                  )}"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Open Proof
                </a>
              </p>
            `;

          } else {

            proofHTML = `
              <p>
                Proof:
                ${escapeHTML(proofValue)}
              </p>
            `;
          }

          return `

            <div class="item">

              <b>
                ${escapeHTML(
                  proof.username ||
                  "Unknown User"
                )}
              </b>

              <p>
                Task:
                ${escapeHTML(
                  proof.task_title ||
                  "Unknown Task"
                )}
              </p>

              <p>
                Reward:
                ৳${proof.reward ?? 0}
              </p>

              ${proofHTML}

              <p>
                Status:
                <strong>
                  ${escapeHTML(
                    proof.status ||
                    "pending"
                  )}
                </strong>
              </p>

              ${
                status === "pending"
                  ? `
                    <button
                      type="button"
                      onclick="reviewProof(
                        ${Number(proof.id)},
                        'approved'
                      )"
                    >
                      ✅ Approve
                    </button>

                    <button
                      type="button"
                      onclick="reviewProof(
                        ${Number(proof.id)},
                        'rejected'
                      )"
                    >
                      ❌ Reject
                    </button>
                  `
                  : ""
              }

            </div>

          `;

        }).join("") ||

        '<p class="muted">No proofs.</p>';
    }

  } catch (error) {

    if ($("proofs")) {
      $("proofs").innerHTML =
        `<p class="error">${escapeHTML(
          error.message
        )}</p>`;
    }
  }


  /* =========================
     WITHDRAWALS
  ========================= */

  try {
    const data =
      await api("/api/admin/withdrawals");

    const withdrawals =
      Array.isArray(data)
        ? data
        : [];

    if ($("withdrawals")) {

      $("withdrawals").innerHTML =
        withdrawals.map(withdrawal => {

          const status =
            String(
              withdrawal.status || ""
            ).toLowerCase();

          return `

            <div class="item">

              <b>
                ${escapeHTML(
                  withdrawal.username ||
                  "Unknown User"
                )}
              </b>

              <p>
                Method:
                ${escapeHTML(
                  withdrawal.method || "-"
                )}
              </p>

              <p>
                Account:
                ${escapeHTML(
                  withdrawal.account || "-"
                )}
              </p>

              <p>
                Amount:
                <strong>
                  ৳${withdrawal.amount ?? 0}
                </strong>
              </p>

              <p>
                Status:
                <strong>
                  ${escapeHTML(
                    withdrawal.status ||
                    "pending"
                  )}
                </strong>
              </p>

              ${
                status === "pending"
                  ? `
                    <button
                      type="button"
                      onclick="reviewWithdrawal(
                        ${Number(withdrawal.id)},
                        'approved'
                      )"
                    >
                      ✅ Approve
                    </button>

                    <button
                      type="button"
                      onclick="reviewWithdrawal(
                        ${Number(withdrawal.id)},
                        'rejected'
                      )"
                    >
                      ❌ Reject
                    </button>
                  `
                  : ""
              }

            </div>

          `;

        }).join("") ||

        '<p class="muted">No withdrawals.</p>';
    }

  } catch (error) {

    if ($("withdrawals")) {
      $("withdrawals").innerHTML =
        `<p class="error">${escapeHTML(
          error.message
        )}</p>`;
    }
  }


  /* =========================
     TELEGRAM SETTINGS
  ========================= */

  try {
    const data =
      await api("/api/admin/settings");

    if ($("tgSupport")) {
      $("tgSupport").value =
        data.telegramSupportUrl || "";
    }

    if ($("tgGroup")) {
      $("tgGroup").value =
        data.telegramGroupUrl || "";
    }

  } catch (error) {

    console.log(
      "Settings load error:",
      error.message
    );
  }
}


/* =========================
   CREATE TASK
========================= */

async function createTask() {

  const title =
    $("taskTitle")?.value.trim();

  const description =
    $("taskDesc")?.value.trim();

  const reward =
    Number(
      $("taskReward")?.value
    );

  if (!title) {
    msg(
      $("taskMsg"),
      "Task title দিন।"
    );
    return;
  }

  if (!description) {
    msg(
      $("taskMsg"),
      "Task description দিন।"
    );
    return;
  }

  if (!reward || reward <= 0) {
    msg(
      $("taskMsg"),
      "Valid reward amount দিন।"
    );
    return;
  }

  try {

    await api(
      "/api/admin/tasks",
      {
        method: "POST",

        body: JSON.stringify({
          title,
          description,
          reward
        })
      }
    );

    msg(
      $("taskMsg"),
      "Task created successfully.",
      true
    );

    if ($("taskTitle"))
      $("taskTitle").value = "";

    if ($("taskDesc"))
      $("taskDesc").value = "";

    if ($("taskReward"))
      $("taskReward").value = "";

    await loadAll();

  } catch (error) {

    msg(
      $("taskMsg"),
      error.message
    );
  }
}


/* =========================
   DELETE TASK
========================= */

async function deleteTask(id) {

  const taskId = Number(id);

  if (!Number.isInteger(taskId)) {
    alert("Invalid Task ID.");
    return;
  }

  const confirmed = confirm(
    "⚠️ এই Task টি Delete করতে চান?\n\n" +
    "Task টি Worker-এর Active Task List থেকে চলে যাবে।\n" +
    "পুরোনো submission/history রাখা থাকবে।"
  );

  if (!confirmed) {
    return;
  }

  try {

    await api(
      `/api/admin/tasks/${taskId}`,
      {
        method: "DELETE"
      }
    );

    alert(
      "✅ Task deleted successfully."
    );

    await loadAll();

  } catch (error) {

    alert(
      "❌ " + error.message
    );
  }
}


/* =========================
   TELEGRAM SETTINGS
========================= */

async function saveTelegram() {

  try {

    await api(
      "/api/admin/settings",
      {
        method: "PUT",

        body: JSON.stringify({

          telegramSupportUrl:
            $("tgSupport")?.value.trim() || "",

          telegramGroupUrl:
            $("tgGroup")?.value.trim() || ""

        })
      }
    );

    msg(
      $("tgMsg"),
      "Telegram settings saved.",
      true
    );

  } catch (error) {

    msg(
      $("tgMsg"),
      error.message
    );
  }
}


/* =========================
   REVIEW PROOF
========================= */

async function reviewProof(id, status) {

  const question =
    status === "approved"
      ? "Approve this proof?"
      : "Reject this proof?";

  if (!confirm(question)) {
    return;
  }

  try {

    await api(
      `/api/admin/proofs/${id}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          status
        })
      }
    );

    await loadAll();

  } catch (error) {

    alert(
      "❌ " + error.message
    );
  }
}


/* =========================
   REVIEW WITHDRAWAL
========================= */

async function reviewWithdrawal(id, status) {

  const question =
    status === "approved"
      ? "Approve this withdrawal?"
      : "Reject this withdrawal?";

  if (!confirm(question)) {
    return;
  }

  try {

    await api(
      `/api/admin/withdrawals/${id}`,
      {
        method: "PATCH",

        body: JSON.stringify({
          status
        })
      }
    );

    await loadAll();

  } catch (error) {

    alert(
      "❌ " + error.message
    );
  }
}


/* =========================
   SECURITY
========================= */

function escapeHTML(value) {

  return String(
    value ?? ""
  ).replace(
    /[&<>"']/g,

    character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character])
  );
}


function escapeAttribute(value) {

  return String(
    value ?? ""
  )
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}


/* =========================
   BUTTONS
========================= */

if ($("loginBtn")) {
  $("loginBtn").onclick = login;
}

if ($("createTaskBtn")) {
  $("createTaskBtn").onclick =
    createTask;
}

if ($("saveTgBtn")) {
  $("saveTgBtn").onclick =
    saveTelegram;
}

if ($("logoutBtn")) {

  $("logoutBtn").onclick = () => {

    token = "";

    localStorage.removeItem(
      "w2e_admin_token"
    );

    showLogin();
  };
}


/* =========================
   AUTO LOGIN
========================= */

if (token) {
  showPanel();
} else {
  showLogin();
}
