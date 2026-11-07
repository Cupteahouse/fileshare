import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm";
import { Upload } from "https://cdn.jsdelivr.net/npm/tus-js-client@4/+esm";

// Chỉ dùng Project URL + publishable/anon key ở frontend. Không dùng service_role.
const SUPABASE_URL = "https://uhyzpobxcvjvhiuzdfjc.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_x3pPpndZj9xlse0HFtn_UA_AopAieSD";
const BUCKET = "public-files";
const MAX_FILE_BYTES = 50 * 1024 * 1024;
// Supabase hiện cấp 1 GB cho Free và 100 GB cho Pro/Team.
// Nếu project thuộc gói khác, sửa giá trị này theo hạn mức của tổ chức Supabase.
const STORAGE_QUOTA_BYTES = 1 * 1024 * 1024 * 1024;

const $ = (id) => document.getElementById(id);
const fileInput = $("fileInput"), dropzone = $("dropzone");
const statusEl = $("uploadStatus"), progressWrap = $("progressWrap");
const progressBar = $("progressBar"), progressPct = $("progressPct");
const progressName = $("progressName"), fileList = $("fileList");
const searchInput = $("searchInput");
const authEmail = $("authEmail"), authPassword = $("authPassword");
const authStatus = $("authStatus"), authForm = $("authForm");

let supabase = null;
let allFiles = [];
let currentUser = null;
const autoDownloaded = new Set();

function configured() {
  return SUPABASE_URL.startsWith("https://") && !SUPABASE_URL.includes("PASTE_") &&
    SUPABASE_ANON_KEY.length > 20 && !SUPABASE_ANON_KEY.includes("PASTE_");
}
function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `upload-status ${type}`;
}
function setAuthStatus(message, type = "") {
  authStatus.textContent = message;
  authStatus.className = `auth-status ${type}`;
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024, i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`;
}
function safeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, c => ({
    "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;"
  }[c]));
}
function makeObjectPath(file, userId) {
  const id = crypto.randomUUID();
  const ext = file.name.includes(".")
    ? file.name.split(".").pop().replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)
    : "";
  return `${userId}/${id}${ext ? "." + ext : ""}`;
}
function projectRefFromUrl() { return new URL(SUPABASE_URL).hostname.split(".")[0]; }
function slugifyFileName(name) {
  const withoutExtension = String(name).replace(/\.[^.]+$/, "");
  const slug = withoutExtension.normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 70).replace(/-+$/g, "");
  return slug || "tep-tai-len";
}
async function makeUniqueSlug(name) {
  const base = slugifyFileName(name);
  for (let suffix = 1; suffix < 1000; suffix++) {
    const candidate = suffix === 1 ? base : `${base}-${suffix}`;
    const { data, error } = await supabase.from("files").select("id").eq("share_slug", candidate).maybeSingle();
    if (error) throw error;
    if (!data) return candidate;
  }
  return `${base}-${crypto.randomUUID().slice(0, 8)}`;
}
function getSharedSlugFromPath() {
  const prefix = "/fileshare/";
  if (!location.pathname.startsWith(prefix)) return null;
  const tail = location.pathname.slice(prefix.length).split("/").filter(Boolean)[0];
  if (!tail || tail === "index.html") return null;
  try { return decodeURIComponent(tail); } catch { return tail; }
}

function updateAuthUI() {
  const signedIn = Boolean(currentUser);
  $("signedOutPanel").hidden = signedIn;
  $("signedInPanel").hidden = !signedIn;
  $("dropzone").hidden = !signedIn;
  $("uploadLoginHint").hidden = signedIn;
  $("signedInEmail").textContent = currentUser?.email || "";
  if (!signedIn) setStatus("Đăng nhập để tải tệp lên. Mọi người vẫn có thể xem và tải tệp công khai.");
}

async function uploadFile(file) {
  if (!supabase) return;
  if (!currentUser) return setStatus("Bạn cần đăng nhập để tải tệp lên.", "error");
  if (file.size === 0) return setStatus("Tệp rỗng không được hỗ trợ.", "error");
  if (file.size > MAX_FILE_BYTES) return setStatus("Tệp vượt quá giới hạn 50 MB.", "error");

  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !session) return setStatus("Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.", "error");
  const path = makeObjectPath(file, currentUser.id);
  let shareSlug;
  try { shareSlug = await makeUniqueSlug(file.name); }
  catch (error) { return setStatus("Không thể tạo liên kết chia sẻ: " + error.message, "error"); }
  progressWrap.hidden = false;
  progressName.textContent = file.name;
  progressBar.style.width = "0%";
  progressPct.textContent = "0%";
  setStatus("Đang tải tệp lên…");

  try {
    const endpoint = `https://${projectRefFromUrl()}.storage.supabase.co/storage/v1/upload/resumable`;
    await new Promise((resolve, reject) => {
      const upload = new Upload(file, {
        endpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        headers: {
          apikey: SUPABASE_ANON_KEY,
          authorization: `Bearer ${session.access_token}`
        },
        uploadDataDuringCreation: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          bucketName: BUCKET,
          objectName: path,
          contentType: file.type || "application/octet-stream",
          cacheControl: "3600",
          metadata: JSON.stringify({ originalName: file.name })
        },
        chunkSize: 6 * 1024 * 1024,
        onError: reject,
        onProgress(bytesUploaded, bytesTotal) {
          const pct = Math.round((bytesUploaded / bytesTotal) * 100);
          progressBar.style.width = `${pct}%`;
          progressPct.textContent = `${pct}%`;
        },
        onSuccess: resolve
      });
      upload.findPreviousUploads().then(previous => {
        if (previous.length) upload.resumeFromPreviousUpload(previous[0]);
        upload.start();
      }).catch(reject);
    });

    const { error: dbError } = await supabase.from("files").insert({
      object_path: path,
      original_name: file.name,
      size_bytes: file.size,
      mime_type: file.type || "application/octet-stream",
      owner_id: currentUser.id,
      share_slug: shareSlug
    });
    if (dbError) throw new Error("Tệp đã tải lên Storage nhưng chưa lưu được thông tin: " + dbError.message);

    progressBar.style.width = "100%";
    progressPct.textContent = "100%";
    setStatus("Tải lên thành công!", "success");
    await loadFiles();
  } catch (error) {
    console.error(error);
    setStatus(error.message || "Không thể tải tệp lên. Vui lòng thử lại.", "error");
  } finally {
    setTimeout(() => { progressWrap.hidden = true; }, 1500);
    fileInput.value = "";
  }
}

async function loadFiles() {
  if (!supabase) return;
  fileList.innerHTML = '<div class="empty-state">Đang tải danh sách tệp…</div>';
  const { data, error } = await supabase.from("files")
    .select("id, object_path, original_name, size_bytes, mime_type, created_at, owner_id, share_slug")
    .order("created_at", { ascending: false }).limit(200);
  if (error) {
    console.error(error);
    fileList.innerHTML = '<div class="empty-state">Không tải được danh sách. Hãy kiểm tra SQL và chính sách RLS.</div>';
    $("fileCount").textContent = "Lỗi kết nối";
    return;
  }
  allFiles = data || [];
  $("fileCount").textContent = `${allFiles.length} tệp gần đây`;
  renderFiles();
  await loadStorageUsage();
  const sharedId = new URLSearchParams(location.search).get("file");
  const sharedSlug = getSharedSlugFromPath();
  if (sharedSlug && !autoDownloaded.has(sharedSlug)) {
    autoDownloaded.add(sharedSlug);
    try {
      const { data: record, error: lookupError } = await supabase.from("files")
        .select("id").eq("share_slug", sharedSlug).maybeSingle();
      if (lookupError) throw lookupError;
      if (!record) { setStatus("Không tìm thấy tệp được chia sẻ.", "error"); return; }
      await downloadFile(record.id);
    } catch (error) {
      console.error(error);
      setStatus("Không thể mở liên kết chia sẻ. Hãy kiểm tra migration SQL đã được chạy chưa. " + error.message, "error");
    }
  } else if (sharedId && !autoDownloaded.has(sharedId)) {
    autoDownloaded.add(sharedId);
    downloadFile(sharedId);
  }
}

async function loadStorageUsage() {
  const status = $("storageStatus");
  try {
    const { data, error } = await supabase.rpc("get_project_storage_usage");
    if (error) throw error;
    const used = Math.max(0, Number(data) || 0);
    const remaining = Math.max(0, STORAGE_QUOTA_BYTES - used);
    const percent = Math.min(100, STORAGE_QUOTA_BYTES ? used / STORAGE_QUOTA_BYTES * 100 : 0);
    $("storageUsed").textContent = formatBytes(used);
    $("storageRemaining").textContent = formatBytes(remaining);
    $("storageQuota").textContent = formatBytes(STORAGE_QUOTA_BYTES);
    $("storageBar").style.width = `${percent}%`;
    $("storageBar").parentElement.setAttribute("aria-valuenow", String(Math.round(percent)));
    status.textContent = `${percent.toFixed(1)}% đã dùng`;
  } catch (error) {
    console.error("Storage usage:", error);
    status.textContent = "Chưa có dữ liệu";
    $("storageUsed").textContent = "—";
    $("storageRemaining").textContent = "—";
    $("storageQuota").textContent = formatBytes(STORAGE_QUOTA_BYTES);
  }
}

function renderFiles() {
  const q = searchInput.value.trim().toLocaleLowerCase();
  const rows = allFiles.filter(f => f.original_name.toLocaleLowerCase().includes(q));
  if (!rows.length) {
    fileList.innerHTML = '<div class="empty-state">Chưa có tệp phù hợp.</div>';
    return;
  }
  fileList.innerHTML = rows.map(f => `
    <article class="file-row">
      <div class="file-icon">▱</div>
      <div class="file-meta">
        <div class="file-name">${safeText(f.original_name)}</div>
        <div class="file-detail">${formatBytes(f.size_bytes)} · ${new Date(f.created_at).toLocaleDateString("vi-VN")}</div>
      </div>
      <button class="download-btn" data-download="${safeText(f.id)}" type="button">↓ Tải về</button>
      <button class="copy-btn" data-copy="${safeText(f.id)}" type="button" aria-label="Sao chép liên kết">↗</button>
      ${currentUser && f.owner_id === currentUser.id ? `<button class="delete-btn" data-delete="${safeText(f.id)}" type="button">Xóa</button>` : ""}
    </article>
  `).join("");
  fileList.querySelectorAll("[data-download]").forEach(btn => btn.addEventListener("click", () => downloadFile(btn.dataset.download)));
  fileList.querySelectorAll("[data-copy]").forEach(btn => btn.addEventListener("click", () => copyLink(btn.dataset.copy)));
  fileList.querySelectorAll("[data-delete]").forEach(btn => btn.addEventListener("click", () => deleteFile(btn.dataset.delete)));
}

async function getFileRecord(id) {
  const { data, error } = await supabase.from("files").select("id, object_path, original_name").eq("id", id).single();
  if (error) throw error;
  return data;
}
async function downloadFile(id) {
  try {
    const record = await getFileRecord(id);
    // Public bucket + SELECT policy cho phép cả anon tải bằng SDK.
    const { data, error } = await supabase.storage.from(BUCKET).download(record.object_path);
    if (error) throw error;
    const objectUrl = URL.createObjectURL(data);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = record.original_name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
  } catch (error) {
    console.error(error);
    setStatus("Không thể tải tệp xuống: " + error.message, "error");
  }
}
async function deleteFile(id) {
  if (!currentUser || !confirm("Bạn chắc chắn muốn xóa tệp này? Hành động này không thể hoàn tác.")) return;
  try {
    const record = await getFileRecord(id);
    const { error: storageError } = await supabase.storage.from(BUCKET).remove([record.object_path]);
    if (storageError) throw storageError;
    const { error: rowError } = await supabase.from("files").delete().eq("id", id);
    if (rowError) throw rowError;
    setStatus("Đã xóa tệp của bạn.", "success");
    await loadFiles();
  } catch (error) {
    console.error(error);
    setStatus("Không thể xóa tệp: " + error.message, "error");
  }
}
async function copyLink(id) {
  const file = allFiles.find(item => item.id === id);
  if (!file?.share_slug) {
    setStatus("Tệp này chưa có mã chia sẻ. Hãy chạy file supabase_setup.sql mới.", "error");
    return;
  }
  const url = new URL(`/fileshare/${encodeURIComponent(file.share_slug)}`, location.origin);
  try {
    await navigator.clipboard.writeText(url.toString());
    setStatus("Đã sao chép liên kết tải tệp.", "success");
  } catch {
    setStatus("Không thể truy cập clipboard. Hãy sao chép URL trên thanh địa chỉ.", "error");
  }
}

$("signUpBtn").addEventListener("click", async () => {
  if (!supabase) return setAuthStatus("Hãy cấu hình Supabase trong app.js trước.", "error");
  const email = authEmail.value.trim(), password = authPassword.value;
  if (!email || password.length < 6) return setAuthStatus("Nhập email hợp lệ và mật khẩu ít nhất 6 ký tự.", "error");
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { emailRedirectTo: location.origin + location.pathname }
  });
  if (error) return setAuthStatus(error.message, "error");
  if (data.session) setAuthStatus("Đăng ký thành công. Bạn đã đăng nhập.", "success");
  else setAuthStatus("Đã tạo tài khoản. Hãy mở email xác nhận, sau đó quay lại đăng nhập.", "success");
});
$("signInBtn").addEventListener("click", async () => {
  if (!supabase) return setAuthStatus("Hãy cấu hình Supabase trong app.js trước.", "error");
  const email = authEmail.value.trim(), password = authPassword.value;
  if (!email || !password) return setAuthStatus("Nhập email và mật khẩu.", "error");
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return setAuthStatus(error.message, "error");
  setAuthStatus("Đăng nhập thành công.", "success");
});
$("signOutBtn").addEventListener("click", async () => {
  if (!supabase) return;
  const { error } = await supabase.auth.signOut();
  if (error) setAuthStatus(error.message, "error");
  else setAuthStatus("Bạn đã đăng xuất.", "success");
});

$("browseBtn").addEventListener("click", e => { e.stopPropagation(); fileInput.click(); });
dropzone.addEventListener("click", () => fileInput.click());
dropzone.addEventListener("keydown", e => {
  if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
});
fileInput.addEventListener("change", () => { if (fileInput.files?.[0]) uploadFile(fileInput.files[0]); });
["dragenter", "dragover"].forEach(name => dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.add("dragover"); }));
["dragleave", "drop"].forEach(name => dropzone.addEventListener(name, e => { e.preventDefault(); dropzone.classList.remove("dragover"); }));
dropzone.addEventListener("drop", e => { const file = e.dataTransfer?.files?.[0]; if (file) uploadFile(file); });
searchInput.addEventListener("input", renderFiles);

authForm.addEventListener("submit", e => e.preventDefault());

if (configured()) {
  supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  supabase.auth.getSession().then(({ data: { session } }) => {
    currentUser = session?.user || null;
    updateAuthUI();
    loadFiles();
  });
  supabase.auth.onAuthStateChange((_event, session) => {
    currentUser = session?.user || null;
    updateAuthUI();
    loadFiles();
  });
} else {
  setAuthStatus("Cần cấu hình Supabase URL và publishable/anon key trong app.js.", "error");
  setStatus("Chưa kết nối Supabase.", "error");
  fileList.innerHTML = '<div class="empty-state">Website đã có giao diện. Hãy hoàn tất cấu hình Supabase để kết nối kho tệp.</div>';
}
