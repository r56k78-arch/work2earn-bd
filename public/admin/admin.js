const $ = (id) => document.getElementById(id);

let token = localStorage.getItem("w2e_admin_token") || "";


function msg(el, text, ok = false) {
  el.textContent = text || "";
  el.className = "msg " + (ok ? "ok" : "");
}


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


function showPanel() {

  $("loginBox").hidden = true;

  $("panel").hidden = false;

  loadAll();
}


function showLogin() {

  $("loginBox").hidden = false;

  $("panel").hidden = true;
}


async function login() {

  const username = $("adminUser").value.trim();

  const password = $("adminPass").value;


  try {

    const data = await api(
      "/api/admin/login",
      {
        method: "POST",

        body: JSON.stringify({
          username,
          password
        })
      }
    );


    token = data.token;

    localStorage.setItem(
      "w2e_admin_token",
      token
    );


    showPanel();

  } catch (error) {

    msg(
      $("loginMsg"),
      error.message
    );

  }
}


async function loadAll() {

  /* DASHBOARD STATS */

  try {

    const data =
      await api("/api/admin/stats");


    $("sUsers").textContent =
      data.users ?? 0;

    $("sTasks").textContent =
      data.tasks ?? 0;

    $("sProofs").textContent =
      data.proofs ?? 0;

    $("sWithdrawals").textContent =
      data.withdrawals ?? 0;

  } catch (error) {

    msg(
      $("status"),
      error.message
    );

  }


  /* TASKS */

  try {

    const data =
      await api("/api/admin/tasks");


    $("tasks").innerHTML =
      (data.tasks || [])
        .map(task => `

          <div class="row">

            <span>

              <b>
                ${escapeHTML(task.title)}
              </b>

              <small>
                ${escapeHTML(
                  task.description || ""
                )}
              </small>

            </span>

            <b>
              ৳${Number(
                task.reward || 0
              ).toFixed(2)}
            </b>

          </div>

        `)
        .join("")
        ||
        '<p class="muted">No tasks yet.</p>';

  } catch (error) {

    $("tasks").textContent =
      error.message;

  }


  /* USERS */

  try {

    const data =
      await api("/api/admin/users");


    $("users").innerHTML =
      (data.users || [])
        .map(user => `

          <div class="row">

            <span>

              <b>
                ${escapeHTML(
                  user.username
                )}
              </b>

              <small>
                ${escapeHTML(
                  user.mobile || ""
                )}
                ·
                ${escapeHTML(
                  user.email || ""
                )}
              </small>

            </span>

            <b>
              ৳${Number(
                user.balance || 0
              ).toFixed(2)}
            </b>

          </div>

        `)
        .join("")
        ||
        '<p class="muted">No users.</p>';

  } catch (error) {

    $("users").textContent =
      error.message;

  }


  /* PROOFS */

  try {

    const data =
      await api("/api/admin/proofs");


    $("proofs").innerHTML =
      (data.proofs || [])
        .map(proof => `

          <div class="row">

            <span>

              <b>
                ${escapeHTML(
                  proof.username || "User"
                )}
              </b>

              <small>
                ${escapeHTML(
                  proof.task_title || "Task"
                )}
                ·
                ${escapeHTML(
                  proof.status || "pending"
                )}
              </small>

            </span>


            <span class="actions">

              ${
                proof.status === "pending"

                ? `

                  <button
                    onclick="reviewProof(
                      ${proof.id},
                      'approved'
                    )"
                  >
                    Approve
                  </button>


                  <button
                    class="danger"
                    onclick="reviewProof(
                      ${proof.id},
                      'rejected'
                    )"
                  >
                    Reject
                  </button>

                `

                : ""

              }

            </span>

          </div>

        `)
        .join("")
        ||
        '<p class="muted">No proofs.</p>';

  } catch (error) {

    $("proofs").textContent =
      error.message;

  }


  /* WITHDRAWALS */

  try {

    const data =
      await api(
        "/api/admin/withdrawals"
      );


    $("withdrawals").innerHTML =
      (data.withdrawals || [])
        .map(withdrawal => `

          <div class="row">

            <span>

              <b>
                ${escapeHTML(
                  withdrawal.username ||
                  "User"
                )}
              </b>

              <small>
                ${escapeHTML(
                  withdrawal.method || ""
                )}
                ·
                ${escapeHTML(
                  withdrawal.account || ""
                )}
              </small>

            </span>


            <span class="actions">

              <b>
                ৳${Number(
                  withdrawal.amount || 0
                ).toFixed(2)}
              </b>


              ${
                withdrawal.status === "pending"

                ? `

                  <button
                    onclick="reviewWithdrawal(
                      ${withdrawal.id},
                      'approved'
                    )"
                  >
                    Approve
                  </button>


                  <button
                    class="danger"
                    onclick="reviewWithdrawal(
                      ${withdrawal.id},
                      'rejected'
                    )"
                  >
                    Reject
                  </button>

                `

                : ""

              }

            </span>

          </div>

        `)
        .join("")
        ||
        '<p class="muted">No withdrawals.</p>';

  } catch (error) {

    $("withdrawals").textContent =
      error.message;

  }


  /* TELEGRAM SETTINGS */

  try {

    const data =
      await api(
        "/api/admin/settings"
      );


    $("tgSupport").value =
      data.telegram_support_url || "";


    $("tgGroup").value =
      data.telegram_group_url || "";

  } catch (error) {

    // Settings unavailable yet.
  }

}


async function createTask() {

  try {

    await api(
      "/api/admin/tasks",
      {
        method: "POST",

        body: JSON.stringify({

          title:
            $("taskTitle")
              .value
              .trim(),

          description:
            $("taskDesc")
              .value
              .trim(),

          reward:
            Number(
              $("taskReward").value
            )

        })

      }
    );


    msg(
      $("taskMsg"),
      "Task created.",
      true
    );


    $("taskTitle").value = "";

    $("taskDesc").value = "";

    $("taskReward").value = "";


    loadAll();

  } catch (error) {

    msg(
      $("taskMsg"),
      error.message
    );

  }

}


async function saveTelegram() {

  try {

    await api(
      "/api/admin/settings",
      {
        method: "PUT",

        body: JSON.stringify({

          telegram_support_url:
            $("tgSupport")
              .value
              .trim(),

          telegram_group_url:
            $("tgGroup")
              .value
              .trim()

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


async function reviewProof(
  id,
  status
) {

  if (
    !confirm(
      status === "approved"
        ? "Approve this proof?"
        : "Reject this proof?"
    )
  ) {

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


    loadAll();

  } catch (error) {

    alert(error.message);

  }

}


async function reviewWithdrawal(
  id,
  status
) {

  if (
    !confirm(
      status === "approved"
        ? "Approve this withdrawal?"
        : "Reject this withdrawal?"
    )
  ) {

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


    loadAll();

  } catch (error) {

    alert(error.message);

  }

}


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


$("loginBtn").onclick = login;


$("createTaskBtn").onclick =
  createTask;


$("saveTgBtn").onclick =
  saveTelegram;


$("logoutBtn").onclick = () => {

  token = "";

  localStorage.removeItem(
    "w2e_admin_token"
  );

  showLogin();

};


if (token) {

  showPanel();

                  }
