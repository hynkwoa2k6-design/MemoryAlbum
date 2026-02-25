// ============================================
// CONSTANTS & CONFIG
// ============================================
// TODO: Bạn cần lấy Client ID từ Google Cloud Console để tính năng upload hoạt động
const GOOGLE_CLIENT_ID = "831264641769-anqogj5ov2mdmarq5in18naunfkspd6a.apps.googleusercontent.com"; 
const DRIVE_SCOPE = "https://www.googleapis.com/auth/drive.file";
const DRIVE_FOLDER_NAME = "AlbumMemory";
const ROOT_FOLDER_ID = "16iD_6EcWv2XYTtyiYAJZmHbJX2rFyljO"; // ID thư mục Drive của bạn
// Optional: public metadata file IDs (make these files "Anyone with the link -> Viewer")
const PUBLIC_ALBUMS_FILE_ID = null; // e.g. '1AbCd...'
const PUBLIC_FILES_FILE_ID = null; // e.g. '1XyZ...'
const ALBUMS_DATA_FILE = "albums_data.json";
const FILES_DATA_FILE = "files_data.json";

// ============================================
// GOOGLE DRIVE DATA MANAGEMENT
// ============================================

let currentAlbumId = null;
let isAdmin = false;

// Admin credentials
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'van1508';

// In-memory cache
let albumsCache = [];
let filesCache = [];
let albumsDataFileId = null;
let filesDataFileId = null;

// Google Drive storage manager
const driveStorageManager = {
    // Load all data from Google Drive
    loadAll: async () => {
        // Try public metadata fetch first (no auth required)
        try {
            if (PUBLIC_ALBUMS_FILE_ID) {
                console.log('Attempting to load public albums metadata from file id', PUBLIC_ALBUMS_FILE_ID);
                const resp = await fetch(`https://drive.google.com/uc?export=download&id=${PUBLIC_ALBUMS_FILE_ID}`);
                if (resp.ok) {
                    const text = await resp.text();
                    try { albumsCache = JSON.parse(text); } catch(e) { albumsCache = []; }
                    console.log('Loaded public albums metadata');
                }
            }
            if (PUBLIC_FILES_FILE_ID) {
                console.log('Attempting to load public files metadata from file id', PUBLIC_FILES_FILE_ID);
                const resp = await fetch(`https://drive.google.com/uc?export=download&id=${PUBLIC_FILES_FILE_ID}`);
                if (resp.ok) {
                    const text = await resp.text();
                    try { filesCache = JSON.parse(text); } catch(e) { filesCache = []; }
                    console.log('Loaded public files metadata');
                }
            }
            if ((PUBLIC_ALBUMS_FILE_ID || PUBLIC_FILES_FILE_ID) && albumsCache && filesCache) {
                // both loaded
                    console.log('Drive (public) data loaded successfully');
                    console.log('albumsCache:', albumsCache);
                    console.log('filesCache:', filesCache);
                return;
            }
        } catch (e) {
            console.warn('Public metadata fetch failed or not configured:', e);
        }

        // Fallback: use authenticated Drive access (requires token)
        if (!driveAccessToken) {
            console.warn("No Drive token, skipping authenticated load");
            return;
        }

        try {
            // Sử dụng trực tiếp ID thư mục gốc bạn cung cấp
            const rootFolderId = ROOT_FOLDER_ID;
            
            // Find or create albums_data.json
            const albumsFile = await driveStorageManager.findOrCreateFile(ALBUMS_DATA_FILE, rootFolderId, '[]');
            albumsDataFileId = albumsFile.id;
            albumsCache = await driveStorageManager.readFile(albumsFile.id);
            if (!Array.isArray(albumsCache)) albumsCache = [];
            
            // Find or create files_data.json
            const filesFile = await driveStorageManager.findOrCreateFile(FILES_DATA_FILE, rootFolderId, '[]');
            filesDataFileId = filesFile.id;
            filesCache = await driveStorageManager.readFile(filesFile.id);
            if (!Array.isArray(filesCache)) filesCache = [];
            
            console.log("Drive data loaded successfully (authenticated)");
            console.log('albumsCache:', albumsCache);
            console.log('filesCache:', filesCache);
        } catch (error) {
            console.error("Error loading Drive data:", error);
        }
    },
    
    // Find file by name in folder or create it
    findOrCreateFile: async (fileName, parentId, defaultContent = '') => {
        try {
            const query = `name = '${fileName}' and mimeType = 'application/json' and '${parentId}' in parents and trashed = false`;
            const response = await gapi.client.drive.files.list({
                q: query,
                spaces: 'drive',
                fields: 'files(id, name)'
            });
            
            if (response.result.files && response.result.files.length > 0) {
                return response.result.files[0];
            }
            
            // Create new file
            const fileMetadata = {
                name: fileName,
                mimeType: 'application/json',
                parents: [parentId]
            };
            
            const media = {
                mimeType: 'application/json',
                body: defaultContent
            };
            
            const file = await gapi.client.drive.files.create({
                resource: fileMetadata,
                media: media,
                fields: 'id'
            });
            
            return { id: file.result.id, name: fileName };
        } catch (error) {
            console.error("Error in findOrCreateFile:", error);
            throw error;
        }
    },
    
    // Read file content from Drive
    readFile: async (fileId) => {
        try {
            // Try using gapi client first
            const response = await gapi.client.drive.files.get({
                fileId: fileId,
                alt: 'media'
            });

            // gapi may return media in response.body or response.result
            const body = response.body || response.result || response;
            if (typeof body === 'string') {
                try {
                    return JSON.parse(body);
                } catch (e) {
                    console.warn('Could not parse Drive file as JSON via gapi, returning raw:', e);
                    return body;
                }
            }
            return body;
        } catch (error) {
            console.warn("gapi readFile failed, trying REST fetch fallback:", error);
            // Fallback: use REST API with fetch and Bearer token (requires driveAccessToken)
            if (!driveAccessToken) {
                console.error('No driveAccessToken available for fetch fallback');
                return [];
            }
            try {
                const resp = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                    headers: {
                        Authorization: 'Bearer ' + driveAccessToken,
                        Accept: 'application/json'
                    }
                });
                if (!resp.ok) {
                    console.error('Fetch fallback failed, status:', resp.status, await resp.text());
                    return [];
                }
                const text = await resp.text();
                try {
                    return JSON.parse(text);
                } catch (e) {
                    return text;
                }
            } catch (e) {
                console.error('Fetch fallback exception while reading file from Drive:', e);
                return [];
            }
        }
    },
    
    // Write file content to Drive
    writeFile: async (fileId, content) => {
        try {
            await gapi.client.drive.files.update({
                fileId: fileId,
                media: {
                    mimeType: 'application/json',
                    body: JSON.stringify(content)
                }
            });
            console.log("File saved to Drive:", fileId);
        } catch (error) {
            console.error("Error writing file to Drive:", error);
            throw error;
        }
    },
    
    // Album operations
    getAlbums: () => albumsCache,
    
    setAlbums: async (albums) => {
        albumsCache = albums;
        if (albumsDataFileId && driveAccessToken && gapiInited) {
            await driveStorageManager.writeFile(albumsDataFileId, albums);
        }
    },
    
    getFiles: () => filesCache,
    
    setFiles: async (files) => {
        filesCache = files;
        if (filesDataFileId && driveAccessToken && gapiInited) {
            await driveStorageManager.writeFile(filesDataFileId, files);
        }
    },
    
    addAlbum: async (album) => {
        const albums = driveStorageManager.getAlbums();
        const newAlbum = {
            id: Date.now().toString(),
            ...album,
            createdAt: new Date().toISOString()
        };
        albums.unshift(newAlbum);
        await driveStorageManager.setAlbums(albums);
        return newAlbum;
    },
    
    deleteAlbum: async (albumId) => {
        const albums = driveStorageManager.getAlbums().filter(a => a.id !== albumId);
        await driveStorageManager.setAlbums(albums);
        const files = driveStorageManager.getFiles().filter(f => f.albumId !== albumId);
        await driveStorageManager.setFiles(files);
    },
    
    addFile: async (file) => {
        const files = driveStorageManager.getFiles();
        const newFile = {
            id: Date.now().toString() + Math.random(),
            ...file,
            uploadedAt: new Date().toISOString()
        };
        files.unshift(newFile);
        await driveStorageManager.setFiles(files);
        return newFile;
    },
    
    deleteFile: async (fileId) => {
        const files = driveStorageManager.getFiles().filter(f => f.id !== fileId);
        await driveStorageManager.setFiles(files);
    },
    
    updateAlbum: async (albumId, updates) => {
        const albums = driveStorageManager.getAlbums();
        const album = albums.find(a => a.id === albumId);
        if (album) {
            Object.assign(album, updates);
            await driveStorageManager.setAlbums(albums);
        }
    },
    
    getFilesByAlbumId: (albumId) => {
        return driveStorageManager.getFiles().filter(f => f.albumId === albumId);
    }
};

// Backwards compatibility alias
const storageManager = driveStorageManager;

// Google Drive state
let tokenClient;
let gapiInited = false;
let gisInited = false;
let driveAccessToken = null;

// Helper: Get direct Drive image URL (avoid CORS issues)
function getDriveImageUrl(fileId) {
    if (!fileId) return null;
    // Use export=download to get direct link
    return `https://drive.google.com/uc?export=view&id=${fileId}`;
}

// Update UI based on login state
function updateAuthUI() {
    const loginBtn = document.getElementById('loginBtn');
    const userSection = document.getElementById('userSection');
    const userEmail = document.getElementById('userEmail');
    const fabBtn = document.getElementById('fabBtn');

    // Luôn hiển thị nội dung chính và nút upload
    document.getElementById('mainContent').classList.remove('hidden');
    if (fabBtn) fabBtn.classList.remove('hidden');

    if (isAdmin) {
        // Admin Mode
        if (loginBtn) loginBtn.style.display = 'none';
        if (userSection) userSection.style.display = 'block';
        if (userEmail) userEmail.textContent = 'Admin';
        document.getElementById('authModal').classList.add('hidden');
    } else {
        // Guest Mode
        if (loginBtn) loginBtn.style.display = 'block';
        if (userSection) userSection.style.display = 'none';
    }
}

// ============================================
// APP INITIALIZATION
// ============================================

// Khởi chạy ứng dụng ngay lập tức
window.addEventListener('DOMContentLoaded', async () => {
    updateAuthUI(); // Set default UI (Guest)
    
    // Init Google Drive API
    gapiLoaded();
    gisLoaded();
    
    // Wait a bit for Google Drive to initialize, then load data
    setTimeout(async () => {
        try {
            if (gapiInited && driveAccessToken) {
                await driveStorageManager.loadAll();
            }
        } catch (error) {
            console.warn("Could not load from Drive on init:", error);
        }
        loadAlbums();   // Load data after Drive setup
    }, 2000);
});

// ============================================
// GOOGLE DRIVE API INITIALIZATION
// ============================================

function gapiLoaded() {
    gapi.load('client', initializeGapiClient);
}

async function initializeGapiClient() {
    await gapi.client.init({
        discoveryDocs: ["https://www.googleapis.com/discovery/v1/apis/drive/v3/rest"],
    });
    gapiInited = true;
}

function gisLoaded() {
    console.log("Initing GIS...");
    if (typeof google === 'undefined' || !google.accounts || !google.accounts.oauth2) {
        console.warn("Google GIS library not ready yet. Retrying in 1s...");
        setTimeout(gisLoaded, 1000);
        return;
    }
    if (tokenClient) return; // Already inited

    tokenClient = google.accounts.oauth2.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: DRIVE_SCOPE,
        callback: (resp) => {
            console.log("Global GSI Callback triggered:", resp);
            if (tokenClient.onTokenCallback) {
                tokenClient.onTokenCallback(resp);
            }
        },
    });
    gisInited = true;
    console.log("GIS Inited successfully.");
}

async function getDriveToken() {
    console.log("Requesting Drive Token...");

    // Warn if mismatching common localhost variations
    if (window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        console.warn("Lưu ý: Bạn đang dùng origin:", window.location.origin);
    }

    if (!gisInited) {
        gisLoaded();
    }

    // Wait for inited status if called too early
    for (let i = 0; i < 5; i++) {
        if (gisInited && tokenClient) break;
        console.log("Waiting for GIS initialization...");
        await new Promise(r => setTimeout(r, 1000));
    }

    if (!tokenClient) {
        throw new Error("Thư viện Google chưa nạp xong. Hãy đợi vài giây rồi thử lại.");
    }

    return new Promise((resolve, reject) => {
        const timeoutId = setTimeout(() => {
            const uploadStatus = document.getElementById('uploadStatus');
            if (uploadStatus && uploadStatus.textContent.includes('khởi tạo')) {
                uploadStatus.innerHTML = '⚠️ Nếu không thấy popup, hãy kiểm tra: <br>1. Trình duyệt có chặn popup không? (Góc trên phải)<br>2. Bạn đã nhấn "Cấp lại quyền" chưa?<br>3. Mở Console (nhấn F12) xem có lỗi đỏ không?';
            }
        }, 4000);

        try {
            tokenClient.onTokenCallback = (resp) => {
                clearTimeout(timeoutId);
                console.log("Token Response received:", resp);
                if (resp.error !== undefined) {
                    reject(resp);
                    return;
                }
                driveAccessToken = resp.access_token;
                // Make sure gapi.client uses the same access token so subsequent gapi.client
                // calls (like permissions.create) are authenticated.
                try {
                    if (gapi && gapi.client) {
                        gapi.client.setToken({ access_token: driveAccessToken });
                    }
                } catch (e) {
                    console.warn('Could not set gapi client token:', e);
                }
                resolve(resp.access_token);
            };

            tokenClient.requestAccessToken({ prompt: 'consent' });
        } catch (err) {
            clearTimeout(timeoutId);
            console.error("requestAccessToken exception:", err);
            reject(err);
        }
    });
}

function clearDriveAuth() {
    driveAccessToken = null;
    alert("Đã xóa cache xác thực. Hãy nhấn 'Tải Lên' lần nữa.");
}

// ============================================
// AUTH FUNCTIONS
// ============================================

function openLoginModal() {
    document.getElementById('authModal').classList.remove('hidden');
}

function closeLoginModal() {
    document.getElementById('authModal').classList.add('hidden');
}

// ============================================
// UPLOAD MODAL
// ============================================

function openUploadModal() {
    const newAlbumInput = document.getElementById('newAlbumName');
    const albumSelect = document.getElementById('albumSelect');
    const albumSelectGroup = albumSelect.parentElement; // The .form-group
    const uploadModalTitle = document.getElementById('uploadModalTitle');

    if (currentAlbumId) {
        // Inside an album — hide album selector
        uploadModalTitle.textContent = 'Thêm vào: ' + document.getElementById('albumTitle').textContent;
        albumSelectGroup.style.display = 'none';
        newAlbumInput.style.display = 'none';
    } else {
        // Not inside an album - show selector and populate it
        uploadModalTitle.textContent = 'Thêm Ảnh/Video';
        albumSelectGroup.style.display = 'block';
        newAlbumInput.style.display = 'none'; // Hide new album name input initially
        
        // Always show the "Create new album" option by adding it directly
        populateAlbumSelector();
        
        // Load data from Drive if available
        if (!driveAccessToken && gapiInited) {
            // Optionally request token to load albums from Drive
            getDriveToken().then(() => {
                return driveStorageManager.loadAll();
            }).then(() => {
                populateAlbumSelector();
            }).catch(e => {
                console.warn("Could not load from Drive:", e);
                // Still show "create new album" option even if Drive not available
            });
        } else if (driveAccessToken) {
            // We already have token, load from Drive
            driveStorageManager.loadAll().then(() => {
                populateAlbumSelector();
            }).catch(e => {
                console.error("Error loading from Drive:", e);
                populateAlbumSelector();
            });
        }
    }

    document.getElementById('description').value = '';
    document.getElementById('uploadStatus').textContent = '';
    document.getElementById('selectedFilesPreview').textContent = '';
    document.getElementById('fileInput').value = '';
    document.getElementById('uploadModal').classList.remove('hidden');
}

async function populateAlbumSelector() {
    const albumSelect = document.getElementById('albumSelect');
    
    try {
        const albums = storageManager.getAlbums();
        albumSelect.innerHTML = ''; // Clear everything

        // Always add option to create a new album first
        const newOption = document.createElement('option');
        newOption.value = '_new_';
        newOption.textContent = '--- Tạo Album Mới ---';
        albumSelect.appendChild(newOption);

        // Add existing albums
        if (albums && albums.length > 0) {
            albums.forEach(album => {
                const option = document.createElement('option');
                option.value = album.id;
                option.textContent = album.name;
                albumSelect.appendChild(option);
            });
        }
        
        // Reset to first option (create new) and trigger change event
        albumSelect.value = '_new_';
        albumSelect.dispatchEvent(new Event('change'));
        
        console.log("Album selector populated with", albums ? albums.length : 0, "albums");
    } catch (error) {
        console.error("Error populating album selector:", error);
        albumSelect.innerHTML = '<option value="">Lỗi tải album</option>';
    }
}

function closeUploadModal() {
    document.getElementById('uploadModal').classList.add('hidden');
}

// Close upload modal when clicking backdrop
document.getElementById('uploadModal').addEventListener('click', function (e) {
    if (e.target === this) closeUploadModal();
});

// Login
document.getElementById('loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value;
    const password = document.getElementById('loginPassword').value;

    // Simple hardcoded check
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        isAdmin = true;
        document.getElementById('loginError').textContent = '';
        updateAuthUI();
        loadAlbums(); // Reload to show delete buttons
        document.getElementById('loginForm').reset();
    } else {
        document.getElementById('loginError').textContent = 'Sai tên đăng nhập hoặc mật khẩu!';
    }
});

// Logout
function logout() {
    isAdmin = false;
    updateAuthUI();
    loadAlbums(); // Reload to hide delete buttons
}

// ============================================
// ADMIN PANEL: PUBLIC METADATA SETUP
// ============================================

async function createPublicMetadataFiles() {
    // Admin only function to create public metadata files on Drive
    if (!isAdmin) {
        alert("Only admin can use this feature");
        return;
    }
    if (!driveAccessToken) {
        alert("Please sign in with Google Drive first");
        return;
    }

    try {
        // Get or create AlbumMemory folder
        const rootFolderId = await getOrCreateDriveFolder(DRIVE_FOLDER_NAME);
        console.log("Root folder ID:", rootFolderId);

        // Create/update albums_data.json
        console.log("Creating public albums metadata file...");
        const albumsBlob = new Blob([JSON.stringify(albumsCache, null, 2)], { type: "application/json" });
        const albumsFile = await uploadPublicFile("albums_data.json", albumsBlob, rootFolderId);
        const albumsFileId = albumsFile.id;
        console.log("Albums file created/updated:", albumsFileId);

        // Create/update files_data.json
        console.log("Creating public files metadata file...");
        const filesBlob = new Blob([JSON.stringify(filesCache, null, 2)], { type: "application/json" });
        const filesFile = await uploadPublicFile("files_data.json", filesBlob, rootFolderId);
        const filesFileId = filesFile.id;
        console.log("Files file created/updated:", filesFileId);

        // Save to sessionStorage for reuse
        sessionStorage.setItem("PUBLIC_ALBUMS_FILE_ID", albumsFileId);
        sessionStorage.setItem("PUBLIC_FILES_FILE_ID", filesFileId);

        // Also log for copy-paste to code
        const configSnippet = `
const PUBLIC_ALBUMS_FILE_ID = '${albumsFileId}';
const PUBLIC_FILES_FILE_ID = '${filesFileId}';
        `;
        console.log("✅ Public metadata files created successfully!");
        console.log("Copy this into script.js constant definitions if you want these to be default:");
        console.log(configSnippet);

        alert(`✅ Public metadata files created!\n\nAlbums File ID:\n${albumsFileId}\n\nFiles File ID:\n${filesFileId}\n\nThese IDs are now saved for this session.\n\nTo make them permanent, copy the config from console and update script.js`);
    } catch (error) {
        console.error("Error creating public metadata files:", error);
        alert("❌ Error creating public files: " + error.message);
    }
}

async function uploadPublicFile(fileName, blob, parentFolderId) {
    // Check if file exists, delete it if so, then upload new one
    const query = `name = '${fileName}' and mimeType = 'application/json' and '${parentFolderId}' in parents and trashed = false`;
    const listResp = await gapi.client.drive.files.list({
        q: query,
        spaces: 'drive',
        fields: 'files(id)'
    });

    if (listResp.result.files && listResp.result.files.length > 0) {
        // File exists, update it
        const existingFileId = listResp.result.files[0].id;
        console.log(`File ${fileName} exists, updating...`);
        await gapi.client.drive.files.update({
            fileId: existingFileId,
            media: {
                mimeType: 'application/json',
                body: blob
            }
        });
        return { id: existingFileId };
    }

    // File doesn't exist, create it
    console.log(`File ${fileName} doesn't exist, creating...`);
    const metadata = {
        name: fileName,
        mimeType: 'application/json',
        parents: [parentFolderId]
    };

    const createResp = await gapi.client.drive.files.create({
        resource: metadata,
        media: {
            mimeType: 'application/json',
            body: blob
        },
        fields: 'id'
    });

    const fileId = createResp.result.id;

    // Set permission to "anyone with link"
    console.log(`Setting permission for ${fileName}...`);
    try {
        await gapi.client.drive.permissions.create({
            fileId: fileId,
            resource: {
                role: 'reader',
                type: 'anyone'
            }
        });
        console.log(`Permission set for ${fileName}`);
    } catch (e) {
        console.warn(`Could not set public permission via gapi for ${fileName}, trying REST API...`);
        try {
            await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + driveAccessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ role: 'reader', type: 'anyone' })
            });
            console.log(`Permission set for ${fileName} via REST`);
        } catch (e2) {
            console.error(`Failed to set permission for ${fileName}:`, e2);
        }
    }

    return { id: fileId };
}

// Listen for album selection changes
document.getElementById('albumSelect').addEventListener('change', e => {
    const newAlbumInput = document.getElementById('newAlbumName');
    if (e.target.value === '_new_') {
        newAlbumInput.style.display = 'block';
        newAlbumInput.value = '';
        newAlbumInput.focus();
    } else {
        newAlbumInput.style.display = 'none';
    }
});
// ============================================
// ALBUM FUNCTIONS
// ============================================

async function connectAndLoad() {
    const btn = document.getElementById('connectDriveBtn');
    if (btn) btn.textContent = '⏳ Đang kết nối...';

    try {
        await getDriveToken();
        await driveStorageManager.loadAll();
        loadAlbums();
    } catch (e) {
        console.error(e);
        alert("Lỗi kết nối: " + (e.message || JSON.stringify(e)));
        if (btn) btn.textContent = '🔄 Thử lại kết nối';
    }
}

async function loadAlbums() {
    const albumList = document.getElementById('albumList');
    albumList.innerHTML = '<p>Đang tải albums...</p>';

    try {
        const albums = storageManager.getAlbums();
        console.log('loadAlbums() albums:', albums);
        albumList.innerHTML = '';

        if (!albums || albums.length === 0) {
            if (!driveAccessToken) {
                albumList.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; color: #999; display: flex; flex-direction: column; align-items: center; gap: 10px;">
                        <p>Chưa kết nối với Google Drive.</p>
                        <button id="connectDriveBtn" class="btn btn-primary" onclick="connectAndLoad()">🔄 Kết nối Google Drive để tải Album</button>
                        <p style="font-size: 12px; color: #666;">(Cần cấp quyền để xem ảnh/video của bạn)</p>
                    </div>
                `;
            } else {
                albumList.innerHTML = `
                    <div style="grid-column: 1/-1; text-align: center; color: #999; display: flex; flex-direction: column; align-items: center; gap: 10px;">
                        <p>Chưa thấy album nào trong dữ liệu.</p>
                        <p>Nếu bạn đã có ảnh trong thư mục Drive này, hãy nhấn nút dưới để quét lại.</p>
                        <button id="syncBtn" class="btn btn-secondary" onclick="syncDriveData()">🔄 Quét & Đồng bộ từ Drive</button>
                    </div>
                `;
            }
            return;
        }

        for (const album of albums) {
            const albumCard = document.createElement('div');
            albumCard.className = 'album-card';
            albumCard.onclick = () => openAlbum(album.id, album.name);

            // Try to get the latest file for the thumbnail
            let thumbnailHtml = '<div class="album-thumbnail">📁</div>';
            try {
                const albumFiles = storageManager.getFilesByAlbumId(album.id);
                if (albumFiles && albumFiles.length > 0) {
                    const fileData = albumFiles[0];
                    const thumbUrl = getDriveImageUrl(fileData.driveId);
                    if (thumbUrl) {
                        thumbnailHtml = `<img src="${thumbUrl}" class="album-thumbnail-img" alt="${album.name}" onerror="this.src='https://via.placeholder.com/300?text=Error'">`;
                    }
                }
            } catch (e) { console.error("Could not load thumbnail", e); }
            
            // Add delete button for admins
            const deleteButtonHtml = isAdmin ? `
                <button
                    class="btn album-delete-btn"
                    title="Xoá Album"
                    onclick="deleteAlbum('${album.id}'); event.stopPropagation();">
                    🗑️
                </button>
            ` : '';
            
            albumCard.innerHTML = `
                ${deleteButtonHtml}
                ${thumbnailHtml}
                <div class="album-card-content">
                    <div class="album-card-title">${album.name}</div>
                    <div class="album-card-info">
                        ${album.fileCount || 0} items
                    </div>
                </div>
            `;
            albumList.appendChild(albumCard);
        }
    } catch (error) {
        console.error('Lỗi khi tải albums:', error);
        albumList.innerHTML = '<p style="color: red;">Lỗi khi tải albums!</p>';
    }
}

async function syncDriveData() {
    if (!driveAccessToken) return;
    const btn = document.getElementById('syncBtn');
    if(btn) btn.textContent = '⏳ Đang quét Drive... (Sẽ mất vài giây)';
    
    try {
        const rootId = ROOT_FOLDER_ID;
        
        // 1. Lấy danh sách thư mục con (Albums)
        const qFolders = `'${rootId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
        const folderResp = await gapi.client.drive.files.list({ q: qFolders, fields: 'files(id, name)', pageSize: 1000 });
        const folders = folderResp.result.files || [];
        
        let newAlbums = [];
        let newFiles = [];
        
        console.log(`Tìm thấy ${folders.length} thư mục.`);

        for (const folder of folders) {
            // 2. Lấy ảnh trong từng thư mục
            const qFiles = `'${folder.id}' in parents and (mimeType contains 'image/' or mimeType contains 'video/') and trashed = false`;
            const fileResp = await gapi.client.drive.files.list({ q: qFiles, fields: 'files(id, name, webContentLink, thumbnailLink, size, createdTime)', pageSize: 1000 });
            const files = fileResp.result.files || [];
            
            // Tạo object Album
            const album = {
                id: folder.id, // Dùng luôn ID Drive làm ID Album
                name: folder.name,
                createdAt: new Date().toISOString(),
                driveFolderId: folder.id,
                fileCount: files.length
            };
            newAlbums.push(album);
            
            // Tạo object Files
            for (const f of files) {
                newFiles.push({
                    id: f.id,
                    albumId: album.id,
                    driveId: f.id,
                    url: f.webContentLink ? f.webContentLink.replace('&export=download', '') : '',
                    name: f.name,
                    type: 'image/jpeg',
                    uploadedAt: f.createdTime,
                    thumbnail: f.thumbnailLink
                });
            }
        }
        
        // Cập nhật Cache và Lưu vào JSON
        albumsCache = newAlbums;
        filesCache = newFiles;
        
        await driveStorageManager.setAlbums(newAlbums);
        await driveStorageManager.setFiles(newFiles);
        
        alert(`Đã đồng bộ thành công!\nTìm thấy: ${newAlbums.length} album và ${newFiles.length} file.`);
        loadAlbums();
        
    } catch (e) {
        console.error(e);
        alert('Lỗi đồng bộ: ' + e.message);
        if(btn) btn.textContent = '🔄 Thử lại';
    }
}

async function deleteAlbum(albumId) {
    if (!isAdmin) {
        alert("Chỉ admin mới có quyền xoá album.");
        return;
    }

    if (!confirm('Bạn có chắc muốn xoá vĩnh viễn album này? Tất cả ảnh/video bên trong cũng sẽ bị xoá! Hành động này không thể hoàn tác.')) return;

    // Show a loading indicator by reducing opacity
    const albumCard = document.querySelector(`[onclick*="deleteAlbum('${albumId}')"]`).closest('.album-card');
    if (albumCard) {
        albumCard.style.pointerEvents = 'none';
        albumCard.style.opacity = '0.5';
    }

    try {
        // Get album data
        const albums = storageManager.getAlbums();
        const album = albums.find(a => a.id === albumId);
        
        if (!album) {
            console.warn("Album to delete not found.");
            loadAlbums(); // Refresh UI
            return;
        }

        // Delete the folder on Drive if it exists
        if (album.driveFolderId && driveAccessToken && gapiInited) {
            console.log(`Attempting to delete Drive folder: ${album.driveFolderId}`);
            try {
                await gapi.client.drive.files.delete({
                    fileId: album.driveFolderId
                });
                console.log("Deleted album folder from Drive");
            } catch (e) {
                console.error("Could not delete folder from Drive, it might already be deleted or permissions are missing.", e);
                // Don't stop the process, just log the error.
            }
        }

        // Delete album and associated files from localStorage
        storageManager.deleteAlbum(albumId);
        console.log("Album deleted from localStorage. Reloading albums.");
        loadAlbums();
    } catch (error) {
        alert('Lỗi khi xoá album: ' + error.message);
        // Restore UI on error
        if (albumCard) {
            albumCard.style.pointerEvents = 'auto';
            albumCard.style.opacity = '1';
        }
    }
}

function openAlbum(albumId, albumName) {
    console.log("Opening album:", albumId, albumName);
    currentAlbumId = albumId;

    const titleEl = document.getElementById('albumTitle');
    const albumSec = document.getElementById('albumSection');
    const filesSec = document.getElementById('filesSection');

    if (titleEl) titleEl.textContent = albumName;
    if (albumSec) {
        albumSec.classList.add('hidden');
        albumSec.style.display = 'none'; // Đảm bảo ẩn
    }
    if (filesSec) {
        filesSec.classList.remove('hidden');
        filesSec.style.display = ''; // Xóa inline style để hiện theo CSS
    }

    loadFiles(albumId);
}

function goBackToAlbums() {
    console.log("Đang quay lại danh sách album...");
    currentAlbumId = null;
    const albumSec = document.getElementById('albumSection');
    const filesSec = document.getElementById('filesSection');

    if (albumSec) {
        albumSec.classList.remove('hidden');
        albumSec.style.display = ''; // Hiện lại album list
    }
    if (filesSec) {
        filesSec.classList.add('hidden');
        filesSec.style.display = 'none'; // Đảm bảo ẩn file list
    }

    loadAlbums();
}

// ============================================
// FILE FUNCTIONS
// ============================================

async function loadFiles(albumId) {
    const filesList = document.getElementById('filesList');
    filesList.innerHTML = '<p>Đang tải files...</p>';

    try {
        const albumFiles = storageManager.getFilesByAlbumId(albumId);
        console.log('loadFiles() albumId:', albumId, 'files:', albumFiles);
        filesList.innerHTML = '';

        if (!albumFiles || albumFiles.length === 0) {
            filesList.innerHTML = '<p style="grid-column: 1/-1; text-align: center; color: #999;">Album trống</p>';
            return;
        }

        albumFiles.forEach(file => {
            const displayUrl = getDriveImageUrl(file.driveId);

            // Chỉ hiện nút xoá ảnh nếu là Admin
            const deleteBtnHtml = isAdmin ? `<button class="btn btn-delete file-btn" onclick="event.stopPropagation(); deleteFile('${file.id}', '${file.driveId}')" title="Xoá">🗑️</button>` : '';

            const fileCard = document.createElement('div');
            fileCard.className = 'file-card';
            fileCard.innerHTML = `
                <img src="${displayUrl}" class="file-thumbnail" alt="${file.name}" onclick="viewFile('${file.url}')" onerror="this.parentElement.innerHTML='<div style=padding:40px;text-align:center>⚠️ Không thể tải ảnh.</div>'">
                <div class="file-card-overlay">
                    ${deleteBtnHtml}
                </div>
                <div class="file-info">
                    <span style="font-size: 11px; color: #888;">${file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString() : 'N/A'}</span>
                    <button class="btn btn-secondary" style="padding: 4px 10px; font-size: 11px;" onclick="viewFile('${file.url}')">View</button>
                </div>
            `;
            filesList.appendChild(fileCard);
        });
    } catch (error) {
        console.error('Lỗi khi tải files:', error);
        filesList.innerHTML = '<p style="color: red;">Lỗi khi tải files!</p>';
    }
}

function viewFile(url) {
    window.open(url, '_blank');
}

async function deleteFile(fileId, driveId) {
    if (!isAdmin) {
        alert("Chỉ Admin mới có quyền xoá ảnh!");
        return;
    }

    if (!confirm('Bạn có chắc muốn xoá file này?')) return;

    try {
        if (gapiInited && driveAccessToken) {
            await gapi.client.drive.files.delete({
                fileId: driveId
            });
        }
        
        // Delete from localStorage
        storageManager.deleteFile(fileId);
        
        // Update file count for the album
        const albums = storageManager.getAlbums();
        const album = albums.find(a => a.id === currentAlbumId);
        if (album) {
            album.fileCount = (album.fileCount || 1) - 1;
            storageManager.setAlbums(albums);
        }

        loadFiles(currentAlbumId);
    } catch (error) {
        alert('Lỗi khi xoá file: ' + error.message);
    }
}

// ============================================
// FILE UPLOAD
// ============================================

const uploadArea = document.getElementById('uploadArea');

document.getElementById('fileInput').addEventListener('change', e => {
    const files = e.target.files;
    const preview = document.getElementById('selectedFilesPreview');
    if (files.length > 0) {
        preview.textContent = `✅ Đã chọn ${files.length} file`;
    } else {
        preview.textContent = '';
    }
});

uploadArea.addEventListener('dragover', handleDragOver);
uploadArea.addEventListener('drop', handleDrop);

function handleDragOver(e) {
    e.preventDefault();
    uploadArea.classList.add('drag-over');
}

function handleDrop(e) {
    e.preventDefault();
    uploadArea.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    document.getElementById('fileInput').files = files;
}

// ============================================
// IMAGE COMPRESSION
// ============================================

/**
 * Compress an image file using Canvas API.
 * Max dimension: 1920px. Quality: 80% JPEG.
 * Videos are returned as-is.
 */
function compressImage(file, maxSize = 1920, quality = 0.8) {
    return new Promise((resolve) => {
        // Skip compression for non-image files
        if (!file.type.startsWith('image/')) {
            resolve(file);
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            const img = new Image();
            img.onload = () => {
                let { width, height } = img;

                // Scale down if needed
                if (width > maxSize || height > maxSize) {
                    if (width > height) {
                        height = Math.round((height * maxSize) / width);
                        width = maxSize;
                    } else {
                        width = Math.round((width * maxSize) / height);
                        height = maxSize;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob(
                    (blob) => {
                        const compressed = new File([blob], file.name, {
                            type: 'image/jpeg',
                            lastModified: Date.now()
                        });
                        resolve(compressed);
                    },
                    'image/jpeg',
                    quality
                );
            };
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

// ============================================
// GOOGLE DRIVE UPLOAD LOGIC
// ============================================

async function getOrCreateDriveFolder(folderName, parentId = null) {
    console.log(`Checking/Creating folder: ${folderName} (parent: ${parentId || 'root'})`);

    let query = `name = '${folderName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    if (parentId) {
        query += ` and '${parentId}' in parents`;
    } else {
        query += ` and 'root' in parents`;
    }

    try {
        const response = await gapi.client.drive.files.list({
            q: query,
            spaces: 'drive',
            fields: 'files(id, name)'
        });

        if (response.result.files && response.result.files.length > 0) {
            const foundId = response.result.files[0].id;
            console.log(`Folder found: ${folderName} ID: ${foundId}`);
            return foundId;
        }

        console.log(`Folder not found, creating: ${folderName}`);
        const folderMetadata = {
            name: folderName,
            mimeType: 'application/vnd.google-apps.folder',
            parents: parentId ? [parentId] : ['root']
        };

        const folder = await gapi.client.drive.files.create({
            resource: folderMetadata,
            fields: 'id'
        });

        console.log(`Folder created: ${folderName} ID: ${folder.result.id}`);
        return folder.result.id;
    } catch (error) {
        console.error(`Error in getOrCreateDriveFolder for ${folderName}:`, error);
        throw error;
    }
}

async function uploadToDrive(file, folderId) {
    const metadata = {
        name: `${Date.now()}_${file.name}`,
        parents: [folderId]
    };

    const formData = new FormData();
    formData.append("metadata", new Blob([JSON.stringify(metadata)], { type: "application/json" }));
    formData.append("file", file);

    const response = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webContentLink,thumbnailLink", {
        method: "POST",
        headers: new Headers({ "Authorization": "Bearer " + driveAccessToken }),
        body: formData
    });
    const result = await response.json();
    if (result.error) {
        console.error("Drive upload error detail:", result.error);
        throw new Error("Drive upload failed: " + (result.error.message || JSON.stringify(result.error)));
    }

    // Set permission to anyone with link can view. Try gapi first, then fallback to REST + fetch.
    try {
        if (gapi && gapi.client) {
            await gapi.client.drive.permissions.create({
                fileId: result.id,
                resource: {
                    role: 'reader',
                    type: 'anyone'
                }
            });
        } else {
            throw new Error('gapi.client not available');
        }
    } catch (e) {
        console.warn('gapi permission create failed, falling back to REST call:', e);
        try {
            await fetch(`https://www.googleapis.com/drive/v3/files/${result.id}/permissions`, {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + driveAccessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ role: 'reader', type: 'anyone' })
            });
            console.log('Fallback permission create succeeded for file', result.id);
        } catch (e2) {
            console.error('Fallback permission create failed:', e2);
        }
    }

    // Normalize returned object with convenient links
    const normalized = {
        id: result.id,
        webContentLink: result.webContentLink || `https://drive.google.com/uc?export=view&id=${result.id}`,
        thumbnailLink: result.thumbnailLink || null
    };
    console.log('File saved to Drive:', normalized);
    return normalized;
}

async function uploadFiles() {
    // Xác định người dùng (nếu không đăng nhập thì là anonymous)
    const userId = isAdmin ? 'admin' : 'anonymous';
    const userEmail = isAdmin ? 'Admin' : 'Guest';

    const files = document.getElementById('fileInput').files;
    const description = document.getElementById('description').value.trim();
    const albumSelect = document.getElementById('albumSelect');

    let albumIdToUse = currentAlbumId; // Use current album if inside one
    let albumNameToUse;

    if (!albumIdToUse) { // Not inside an album, use the selector
        const selectedValue = albumSelect.value;
        if (selectedValue === '_new_') {
            albumNameToUse = document.getElementById('newAlbumName').value.trim();
            if (!albumNameToUse) {
                alert('Vui lòng nhập tên cho album mới!');
                return;
            }
        } else if (selectedValue) {
            albumIdToUse = selectedValue;
            albumNameToUse = albumSelect.options[albumSelect.selectedIndex].text;
        } else {
            alert('Vui lòng chọn một album hoặc tạo album mới!');
            return;
        }
    } else {
        albumNameToUse = document.getElementById('albumTitle').textContent;
    }

    if (files.length === 0) {
        alert('Vui lòng chọn ảnh hoặc video!');
        return;
    }

    const uploadStatus = document.getElementById('uploadStatus');
    uploadStatus.textContent = 'Đang khởi tạo kết nối Drive...';

    try {
        // Ensure we have a Drive token
        if (!driveAccessToken) {
            await getDriveToken();
        }

        const rootFolderId = ROOT_FOLDER_ID;

        // Create or get album from localStorage
        let finalAlbumId = albumIdToUse;
        let albumDriveFolderId = null;

        // If we have an ID, get the folder ID from it
        if (finalAlbumId) {
            const albums = storageManager.getAlbums();
            const album = albums.find(a => a.id === finalAlbumId);
            if (album) {
                albumDriveFolderId = album.driveFolderId;
            } else {
                finalAlbumId = null; // Album was deleted, so we'll create a new one
            }
        } else {
            // We only have a name, so check if it exists
            const albums = storageManager.getAlbums();
            const album = albums.find(a => a.name === albumNameToUse);
            if (album) {
                finalAlbumId = album.id;
                albumDriveFolderId = album.driveFolderId;
            }
        }

        // Verify/Create album folder in Drive
        if (albumDriveFolderId) {
            try {
                await gapi.client.drive.files.get({ fileId: albumDriveFolderId });
            } catch (e) {
                console.warn("Existing Drive folder ID invalid or inaccessible, will re-create", e);
                albumDriveFolderId = null;
            }
        }

        if (!albumDriveFolderId) {
            uploadStatus.textContent = `📁 Đang tạo thư mục album trên Drive...`;
            albumDriveFolderId = await getOrCreateDriveFolder(albumNameToUse, rootFolderId);

            if (finalAlbumId) {
                storageManager.updateAlbum(finalAlbumId, { driveFolderId: albumDriveFolderId });
            } else {
                const newAlbum = storageManager.addAlbum({
                    name: albumNameToUse,
                    description: description,
                    userId: userId,
                    driveFolderId: albumDriveFolderId,
                    fileCount: 0
                });
                finalAlbumId = newAlbum.id;
            }
        }

        // Upload files
        let uploadedCount = 0;
        for (const file of files) {
            // Compress images before upload
            const isImage = file.type.startsWith('image/');
            if (isImage) {
                uploadStatus.textContent = `⏳ Đang nén ảnh (${uploadedCount + 1}/${files.length})...`;
            }
            const fileToUpload = isImage ? await compressImage(file) : file;

            uploadStatus.textContent = `☁️ Đang upload lên Drive (${uploadedCount + 1}/${files.length})...`;

            const driveResult = await uploadToDrive(fileToUpload, albumDriveFolderId);

            // Generate a direct link if possible, or use webContentLink
            // thumbnailLink is often small, webContentLink is a download link
            const viewUrl = driveResult.webContentLink.replace('&export=download', '');

            storageManager.addFile({
                albumId: finalAlbumId,
                url: viewUrl,
                driveId: driveResult.id,
                name: file.name,
                type: file.type,
                size: file.size,
                uploadedBy: userEmail,
                thumbnail: driveResult.thumbnailLink || viewUrl
            });

            uploadedCount++;
        }

        // Update album file count
        const albums = storageManager.getAlbums();
        const album = albums.find(a => a.id === finalAlbumId);
        if (album) {
            album.fileCount = (album.fileCount || 0) + uploadedCount;
            storageManager.setAlbums(albums);
        }

        uploadStatus.textContent = `✅ Tải lên ${uploadedCount} file thành công!`;
        document.getElementById('newAlbumName').value = '';
        document.getElementById('selectedFilesPreview').textContent = '';

        setTimeout(() => {
            uploadStatus.textContent = '';
            closeUploadModal();
            if (currentAlbumId) {
                loadFiles(currentAlbumId);
            } else {
                loadAlbums();
            }
        }, 1500);
    } catch (error) {
        console.error('Upload error details:', error);
        let msg = error.message;

        if (!msg) {
            if (error.error === "popup_blocked_by_browser") {
                msg = "Trình duyệt đã chặn popup. Hãy bật popup cho trang này.";
            } else if (error.error === "access_denied") {
                msg = "Bạn đã từ chối cấp quyền truy cập Drive.";
            } else if (typeof error === 'object') {
                msg = JSON.stringify(error);
            } else {
                msg = "Xác thực Drive thất bại";
            }
        }

        document.getElementById('uploadStatus').textContent = '❌ Lỗi: ' + msg;
    }
}
