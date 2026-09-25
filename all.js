





        const firebaseConfig = {
            apiKey: "AIzaSyCq7gTAuPBaY3qdk-Q8oX8hG-t5apsBELE",
            authDomain: "imagens-frota.firebaseapp.com",
            projectId: "imagens-frota",
            storageBucket: "imagens-frota.firebasestorage.app",
            messagingSenderId: "159326049457",
            appId: "1:159326049457:web:4a6161e934f215af347e90",
            measurementId: "G-38FQCRH88B"
        };
        
        firebase.initializeApp(firebaseConfig);
        const db = firebase.firestore();
        const auth = firebase.auth();

        // Mantém a sessão entre acessos, mas expira após 5 horas de inatividade.
        const SESSION_IDLE_MS = 5 * 60 * 60 * 1000;
        const LAST_ACTIVITY_KEY = 'cb-frota-last-activity';
        let lastActivityWrite = 0;

        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL).catch(err => {
            console.warn('Não foi possível configurar persistência local:', err);
        });

        function getLastActivity() {
            const value = Number(localStorage.getItem(LAST_ACTIVITY_KEY) || 0);
            return Number.isFinite(value) ? value : 0;
        }

        function markUserActivity(force = false) {
            if (!auth.currentUser) return;
            const now = Date.now();
            if (!force && now - lastActivityWrite < 60000) return;
            lastActivityWrite = now;
            localStorage.setItem(LAST_ACTIVITY_KEY, String(now));
        }

        ['click', 'keydown', 'touchstart', 'mousemove'].forEach(eventName => {
            window.addEventListener(eventName, () => markUserActivity(false), { passive: true });
        });

        db.enablePersistence({ synchronizeTabs: true }).catch(err => {
            console.log("Aviso de persistência offline:", err.code);
        });

        const ALL_UNITS = ["CB NORTE", "CB SUL", "BARREIRAS", "JUAZEIRO", "OT"];

        // E-MAIL MESTRE INICIAL
        const MASTER_SUPER_ADM = "aqueiroz@cbdistribuidora.com.br";
        let authorizedEditorsList = [MASTER_SUPER_ADM];

        const cycleInfo = [
            { label: "1º CICLO", range: "Abril - Junho" },
            { label: "2º CICLO", range: "Julho - Setembro" },
            { label: "3º CICLO", range: "Outubro - Dezembro" }
        ];

        let rawFleetDocs = []; 
        let activeUnit = "CB NORTE";
        let activeYear = "2025"; 
        let availableYears = ["2025"];
        let currentIndex = 0;
        let searchTerm = "";
        let isAdmin = false;
        let activeTruckSlots = {};

        // POSIÇÃO DE NAVEGAÇÃO POR LOGIN
        // Cada usuário mantém, neste dispositivo/navegador, o último ano, unidade e veículo visitados.
        const NAV_STATE_PREFIX = 'cb-frota-nav-state-v1:';
        let pendingNavigationState = null;
        let isRestoringNavigationState = false;

        function getNavigationStateKey() {
            const user = auth.currentUser;
            return user ? `${NAV_STATE_PREFIX}${user.uid}` : null;
        }

        function loadNavigationStateForCurrentUser() {
            const key = getNavigationStateKey();
            if (!key) return null;
            try {
                const parsed = JSON.parse(localStorage.getItem(key) || 'null');
                if (!parsed || typeof parsed !== 'object') return null;
                return {
                    year: String(parsed.year || ''),
                    unit: String(parsed.unit || ''),
                    vehicleId: String(parsed.vehicleId || '')
                };
            } catch (error) {
                console.warn('Estado de navegação inválido:', error);
                return null;
            }
        }

        function saveNavigationState() {
            if (isRestoringNavigationState || !auth.currentUser) return;
            const key = getNavigationStateKey();
            if (!key) return;
            const list = getCurrentFilteredList();
            const truck = list[currentIndex] || list[0];
            if (!truck || !truck.id) return;

            localStorage.setItem(key, JSON.stringify({
                year: activeYear,
                unit: activeUnit,
                vehicleId: truck.id,
                updatedAt: Date.now()
            }));
        }

        function restoreNavigationPositionAfterFleetLoad() {
            if (!pendingNavigationState) {
                isRestoringNavigationState = false;
                return;
            }

            const saved = pendingNavigationState;
            if (ALL_UNITS.includes(saved.unit)) activeUnit = saved.unit;

            currentIndex = 0;
            if (saved.vehicleId) {
                const list = getCurrentFilteredList();
                const savedIndex = list.findIndex(truck => truck.id === saved.vehicleId);
                if (savedIndex >= 0) currentIndex = savedIndex;
            }

            pendingNavigationState = null;
            isRestoringNavigationState = false;
        }

        const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

        function showToast(message, type = 'success') {
            const container = document.getElementById('toast-container');
            const toast = document.createElement('div');
            
            const isSuccess = type === 'success';
            const bgColor = isSuccess ? 'bg-slate-900 border-green-500' : 'bg-red-950 border-red-500';
            const iconColor = isSuccess ? 'text-green-400' : 'text-red-400';
            const iconName = isSuccess ? 'check-circle-2' : 'alert-circle';

            toast.className = `toast-animate flex items-center gap-2.5 px-4 py-2.5 rounded-xl border ${bgColor} text-white text-[11px] font-black shadow-2xl pointer-events-auto`;
            toast.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4 ${iconColor}"></i> <span>${message}</span>`;
            
            container.appendChild(toast);
            lucide.createIcons();

            setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateY(-10px)';
                toast.style.transition = 'all 0.3s ease';
                setTimeout(() => toast.remove(), 300);
            }, 2500);
        }

        // LÓGICA DE LOGIN PRINCIPAL
        function resetLoginButton() {
            const btnSubmit = document.getElementById('btn-login-submit');
            if (!btnSubmit) return;
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = `<i data-lucide="log-in" class="w-4 h-4"></i> ACESSAR`;
            lucide.createIcons();
        }

        async function handleMainLogin() {
            const email = document.getElementById('main-login-email').value.trim();
            const password = document.getElementById('main-login-password').value.trim();
            const btnSubmit = document.getElementById('btn-login-submit');

            if (!email || !password) {
                showToast("Preencha o e-mail e a senha!", "error");
                return;
            }

            const originalBtnText = btnSubmit.innerHTML;
            btnSubmit.disabled = true;
            btnSubmit.innerHTML = `<i data-lucide="refresh-cw" class="w-4 h-4 animate-spin"></i> AUTENTICANDO...`;
            lucide.createIcons();

            try {
                await auth.signInWithEmailAndPassword(email, password);
                showToast("Acesso liberado!");
            } catch (error) {
                btnSubmit.innerHTML = originalBtnText;
                btnSubmit.disabled = false;
                lucide.createIcons();
                showToast("Erro de acesso: " + error.message, "error");
            }
        }

        function resetEditMode() {
            // O modo de edição é apenas estado de sessão (isAdmin).
            // Ao sair/trocar de usuário, precisamos também reconstruir a parte
            // visual que foi gerada pelo renderSlotsGridOnly(), pois ela contém
            // selects, botões de excluir e áreas de upload que só existem no modo edição.
            isAdmin = false;

            const text = document.getElementById('adm-btn-text');
            if (text) text.innerText = "Editar ✏️";

            ['adm-fields-container', 'btn-add-truck', 'btn-add-year', 'btn-batch-import', 'btn-sync-fleet-data']
                .forEach(id => {
                    const el = document.getElementById(id);
                    if (el) el.classList.add('hidden');
                });

            // Corrige o caso em que o usuário sai e entra novamente:
            // a variável volta para false, mas o HTML antigo continuava na tela.
            if (typeof renderSlotsGridOnly === 'function' && Array.isArray(rawFleetDocs) && rawFleetDocs.length) {
                renderSlotsGridOnly();
            }
        }

        async function handleSignOut() {
            // O modo de edição pertence somente à sessão atual.
            // Reseta o estado lógico e visual ANTES de encerrar a autenticação.
            resetEditMode();
            resetLoginButton();
            localStorage.removeItem(LAST_ACTIVITY_KEY);
            try {
                await auth.signOut();
                showToast("Você saiu da aplicação.");
            } catch (error) {
                console.error("Erro ao sair:", error);
                showToast("Não foi possível encerrar a sessão.", "error");
            }
        }

        // CARREGA A LISTA DE EDITORES DO FIRESTORE EM TEMPO REAL
        function listenToAuthorizedEditors() {
            db.collection("settings").doc("editors").onSnapshot(doc => {
                if (doc.exists && doc.data().list) {
                    authorizedEditorsList = doc.data().list;
                } else {
                    db.collection("settings").doc("editors").set({ list: [MASTER_SUPER_ADM] });
                    authorizedEditorsList = [MASTER_SUPER_ADM];
                }
                checkUserPermissions();
            });
        }

        function checkUserPermissions() {
            const user = auth.currentUser;
            const btnAdmAuth = document.getElementById('btn-adm-auth');
            const btnManageEditors = document.getElementById('btn-manage-editors');

            if (user) {
                const userEmail = user.email ? user.email.toLowerCase() : "";
                const isAuthorized = authorizedEditorsList.some(email => email.toLowerCase() === userEmail);

                if (isAuthorized) {
                    btnAdmAuth.classList.remove('hidden');
                    btnManageEditors.classList.remove('hidden');
                } else {
                    btnAdmAuth.classList.add('hidden');
                    btnManageEditors.classList.add('hidden');
                    isAdmin = false;
                }
            } else {
                btnAdmAuth.classList.add('hidden');
                btnManageEditors.classList.add('hidden');
                isAdmin = false;
            }
            lucide.createIcons();
        }

        auth.onAuthStateChanged(async user => {
            const loginScreen = document.getElementById('app-login-screen');
            const loadingScreen = document.getElementById('auth-loading-screen');

            if (user) {
                const lastActivity = getLastActivity();
                const sessionExpired = lastActivity > 0 && (Date.now() - lastActivity) > SESSION_IDLE_MS;

                if (sessionExpired) {
                    localStorage.removeItem(LAST_ACTIVITY_KEY);
                    resetEditMode();
                    await auth.signOut();
                    return;
                }

                markUserActivity(true);
                pendingNavigationState = loadNavigationStateForCurrentUser();
                isRestoringNavigationState = true;
                loginScreen.classList.add('hidden');
                loadingScreen.classList.add('hidden');

                // Toda nova sessão começa fora do modo de edição.
                resetEditMode();

                listenToAuthorizedEditors();
                loadYearsList();
            } else {
                resetEditMode();
                resetLoginButton();
                loadingScreen.classList.add('hidden');
                loginScreen.classList.remove('hidden');
                isAdmin = false;
                if (unsubscribeFleet) unsubscribeFleet();
                if (unsubscribeSlots) unsubscribeSlots();
            }
            lucide.createIcons();
        });

        // GERENCIAMENTO DE EDITORES DENTRO DO SITE
        function openEditorsModal() {
            document.getElementById('editors-modal').classList.remove('hidden');
            renderEditorsList();
        }

        function closeEditorsModal() {
            document.getElementById('editors-modal').classList.add('hidden');
        }

        function renderEditorsList() {
            const container = document.getElementById('editors-list-container');
            container.innerHTML = authorizedEditorsList.map(email => `
                <div class="flex justify-between items-center p-2 bg-slate-50 rounded-xl border border-slate-200 text-xs font-bold text-slate-800">
                    <span>${email}</span>
                    ${email.toLowerCase() !== MASTER_SUPER_ADM.toLowerCase() ? `
                        <button onclick="removeEditorEmail('${email}')" class="text-red-500 hover:text-red-700 p-1" title="Remover permissão"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>
                    ` : '<span class="text-[8px] bg-slate-200 text-slate-600 px-2 py-0.5 rounded font-black">ADM</span>'}
                </div>
            `).join('');
            lucide.createIcons();
        }

        async function addEditorEmail() {
            const emailInput = document.getElementById('new-editor-email').value.trim().toLowerCase();
            if (!emailInput || !emailInput.includes('@')) {
                showToast("Digite um e-mail válido!", "error");
                return;
            }

            if (authorizedEditorsList.includes(emailInput)) {
                showToast("Este e-mail já é um editor!", "error");
                return;
            }

            authorizedEditorsList.push(emailInput);
            await db.collection("settings").doc("editors").set({ list: authorizedEditorsList });
            document.getElementById('new-editor-email').value = "";
            showToast("Novo editor cadastrado!");
            renderEditorsList();
        }

        async function removeEditorEmail(emailToRemove) {
            if (emailToRemove.toLowerCase() === MASTER_SUPER_ADM.toLowerCase()) return;
            authorizedEditorsList = authorizedEditorsList.filter(e => e.toLowerCase() !== emailToRemove.toLowerCase());
            await db.collection("settings").doc("editors").set({ list: authorizedEditorsList });
            showToast("Editor removido!");
            renderEditorsList();
        }

        function toggleEditMode() {
            isAdmin = !isAdmin;

            if (isAdmin) {
                document.getElementById('adm-btn-text').innerText = "Sair da edição";
                document.getElementById('adm-fields-container').classList.remove('hidden');
                document.getElementById('btn-add-truck').classList.remove('hidden');
                document.getElementById('btn-add-year').classList.remove('hidden');
                document.getElementById('btn-batch-import').classList.remove('hidden');
                document.getElementById('btn-sync-fleet-data').classList.remove('hidden');
                showToast("Modo de edição ativado!");
            } else {
                document.getElementById('adm-btn-text').innerText = "Editar ✏️";
                document.getElementById('adm-fields-container').classList.add('hidden');
                document.getElementById('btn-add-truck').classList.add('hidden');
                document.getElementById('btn-add-year').classList.add('hidden');
                document.getElementById('btn-batch-import').classList.add('hidden');
                document.getElementById('btn-sync-fleet-data').classList.add('hidden');
                showToast("Modo edição desativado.");
            }
            render();
        }

        // IMPORTAÇÃO DE FOTOS FLEXÍVEL (ACEITA QUALQUER NOME DE FOTO E DISTRIBUI SEQUENCIALMENTE)
        function triggerFolderSelect() {
            if (!isAdmin) return;
            const input = document.getElementById('folder-batch-input');
            input.value = '';
            input.click();
        }

        function mapearCiclo(nomePasta) {
            const text = nomePasta.toUpperCase().trim();
            if (text.includes("PRIMEIRO") || text.includes("1º") || text.includes("1 CICLO") || text.includes("CICLO 1")) return 0;
            if (text.includes("SEGUNDO") || text.includes("2º") || text.includes("2 CICLO") || text.includes("CICLO 2")) return 1;
            if (text.includes("TERCEIRO") || text.includes("3º") || text.includes("3 CICLO") || text.includes("CICLO 3")) return 2;
            return -1;
        }

        function mapearUnidade(nomePasta) {
            const text = nomePasta.toUpperCase().trim();
            return ALL_UNITS.find(unit => text === unit || text.includes(unit)) || null;
        }

        function solicitarCicloParaUnidade(unit) {
            const resposta = prompt(
                `A pasta da unidade "${unit}" não contém o nome do ciclo no caminho.\n\n` +
                `Digite o ciclo ao qual TODOS os veículos desta unidade pertencem:\n` +
                `1 = 1º Ciclo\n2 = 2º Ciclo\n3 = 3º Ciclo`
            );
            if (resposta === null) return -1;
            const value = resposta.trim();
            if (value === '1' || value === '2' || value === '3') return Number(value) - 1;
            showToast(`Ciclo inválido para ${unit}. A importação desta unidade foi ignorada.`, "error");
            return -1;
        }

        async function handleFolderBatchUpload(input) {
            const files = Array.from(input.files || []);
            if (files.length === 0) return;
            if (!isAdmin) {
                showToast("Ative o modo de edição para importar fotos.", "error");
                return;
            }

            const imageFiles = files.filter(file => file.type.startsWith('image/'));
            if (imageFiles.length === 0) {
                showToast("A pasta selecionada não contém imagens.", "error");
                return;
            }

            showToast(`Analisando ${imageFiles.length} imagens...`);

            const grouped = new Map();
            const pendingByUnit = new Map();
            const ignored = [];
            const currentFleetIds = new Set(rawFleetDocs.map(t => String(t.id)));

            for (const file of imageFiles) {
                const pathParts = (file.webkitRelativePath || file.name).split('/');
                let cycleIdx = -1;
                let unit = null;
                let truckId = "";

                for (const rawPart of pathParts) {
                    const part = rawPart.trim();
                    if (cycleIdx === -1) cycleIdx = mapearCiclo(part);
                    if (!unit) unit = mapearUnidade(part);
                    if (/^\d+$/.test(part)) truckId = part;
                }

                if (!truckId) {
                    ignored.push(`${file.name}: veículo não identificado`);
                    continue;
                }
                if (!currentFleetIds.has(String(truckId))) {
                    ignored.push(`${file.name}: veículo ${truckId} não existe em ${activeYear}`);
                    continue;
                }

                // Se o ciclo já estiver no caminho (ciclo > unidade > veículo > imagem),
                // nunca pergunta nada: o caminho já determina o ciclo.
                if (cycleIdx !== -1) {
                    const key = `${cycleIdx}_${truckId}`;
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key).push(file);
                    continue;
                }

                // Caso o usuário selecione somente a pasta da unidade, perguntamos
                // UMA única vez por unidade e aplicamos a resposta a todos os veículos.
                if (!unit) {
                    ignored.push(`${file.name}: unidade não reconhecida no caminho`);
                    continue;
                }
                if (!pendingByUnit.has(unit)) pendingByUnit.set(unit, []);
                pendingByUnit.get(unit).push({ file, truckId });
            }

            for (const [unit, entries] of pendingByUnit.entries()) {
                const cycleIdx = solicitarCicloParaUnidade(unit);
                if (cycleIdx === -1) {
                    entries.forEach(({ file }) => ignored.push(`${file.name}: ciclo não definido para ${unit}`));
                    continue;
                }
                entries.forEach(({ file, truckId }) => {
                    const key = `${cycleIdx}_${truckId}`;
                    if (!grouped.has(key)) grouped.set(key, []);
                    grouped.get(key).push(file);
                });
            }

            let imported = 0;
            let failed = 0;
            let excess = 0;
            const affectedTrucks = new Set();

            // A tela possui 4 slots por ciclo. Importamos no máximo 4 por veículo/ciclo,
            // com nomes "slot1"..."slot4" tendo prioridade sobre a ordem alfabética.
            for (const [key, groupFiles] of grouped.entries()) {
                const [cycleIdxText, truckId] = key.split('_');
                const cycleIdx = Number(cycleIdxText);
                const docId = `${activeYear}_${truckId}`;
                const truckRef = db.collection('fleet').doc(docId);

                try {
                    const truckDoc = await truckRef.get();
                    if (!truckDoc.exists) {
                        ignored.push(`Veículo ${truckId}: cadastro não encontrado no banco`);
                        continue;
                    }

                    const explicit = new Map();
                    const automatic = [];

                    groupFiles
                        .slice()
                        .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
                        .forEach(file => {
                            const match = file.name.toLowerCase().match(/slot[\s_-]*([1-4])(?:\D|$)/);
                            if (match) {
                                const slot = Number(match[1]);
                                if (!explicit.has(slot)) explicit.set(slot, file);
                                else automatic.push(file);
                            } else {
                                automatic.push(file);
                            }
                        });

                    const assignments = new Map(explicit);
                    const freeSlots = [1, 2, 3, 4].filter(slot => !assignments.has(slot));
                    for (const file of automatic) {
                        const slot = freeSlots.shift();
                        if (!slot) {
                            excess++;
                            ignored.push(`${file.name}: excede os 4 slots do veículo ${truckId}, ciclo ${cycleIdx + 1}`);
                            continue;
                        }
                        assignments.set(slot, file);
                    }

                    for (const [slotNum, file] of [...assignments.entries()].sort((a,b) => a[0]-b[0])) {
                        try {
                            const finalBase64 = await compressImage(file);
                            const slotDocId = `c${cycleIdx}_s${slotNum}`;

                            await truckRef.collection('slots').doc(slotDocId).set({
                                base64: finalBase64,
                                year: activeYear,
                                cycleIdx,
                                truckDocId: docId,
                                updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                            }, { merge: true });

                            imported++;
                            affectedTrucks.add(docId);
                            console.log(`[${imported}] Veículo ${truckId} | Ciclo ${cycleIdx + 1} | Slot ${slotNum}`);
                        } catch (photoError) {
                            failed++;
                            console.error(`Falha na foto ${file.name}:`, photoError);
                        }
                    }

                    await refreshTruckPhotoSummary(docId);
                } catch (error) {
                    failed++;
                    console.error(`Erro ao importar veículo ${truckId}:`, error);
                }
            }

            input.value = '';

            if (imported > 0) {
                updateDashboardCacheFromCurrentFleet();
                render();
                const details = [
                    `${imported} foto${imported === 1 ? '' : 's'} importada${imported === 1 ? '' : 's'}`,
                    `${affectedTrucks.size} veículo${affectedTrucks.size === 1 ? '' : 's'}`,
                    ignored.length ? `${ignored.length} ignorada${ignored.length === 1 ? '' : 's'}` : '',
                    failed ? `${failed} erro${failed === 1 ? '' : 's'}` : ''
                ].filter(Boolean).join(' • ');
                showToast(details, failed ? "error" : "success");
                if (ignored.length) console.warn("Arquivos ignorados na importação:", ignored);
            } else {
                showToast(`Nenhuma foto importada${ignored.length ? ` • ${ignored.length} arquivo(s) ignorado(s)` : ''}.`, "error");
                if (ignored.length) console.warn("Arquivos ignorados na importação:", ignored);
            }
        }

        // DASHBOARD CORRIGIDO: LÊ AS FOTOS DIRETAMENTE DO BANCO DE DADOS
function buildPhotoSummaryFromSlotKeys(slotKeys = [], legacyImages = {}) {
    const keySet = new Set(slotKeys);
    const cycles = [false, false, false];
    for (let cycleIdx = 0; cycleIdx < 3; cycleIdx++) {
        cycles[cycleIdx] = [1, 2, 3, 4].some(slotIdx => {
            const key = `c${cycleIdx}_s${slotIdx}`;
            return keySet.has(key) || Boolean(legacyImages && legacyImages[key]);
        });
    }
    return { cycles, updatedAtMs: Date.now() };
}

async function refreshTruckPhotoSummary(truckDocId) {
    if (!truckDocId) return null;
    try {
        const truck = rawFleetDocs.find(t => t.docId === truckDocId);
        const snapshot = await db.collection('fleet').doc(truckDocId).collection('slots').get();
        const summary = buildPhotoSummaryFromSlotKeys(snapshot.docs.map(doc => doc.id), truck ? truck.legacyImages : {});
        await db.collection('fleet').doc(truckDocId).set({ photoSummary: summary }, { merge: true });
        if (truck) truck.photoSummary = summary;
        updateDashboardCacheFromCurrentFleet();
        return summary;
    } catch (error) {
        console.warn('Falha ao atualizar resumo de fotos:', truckDocId, error);
        return null;
    }
}

function truckHasPhotoInCycle(truck, cycleIdx) {
    if (truck.photoSummary && Array.isArray(truck.photoSummary.cycles)) {
        return Boolean(truck.photoSummary.cycles[cycleIdx]);
    }
    return [1, 2, 3, 4].some(slotIdx => Boolean(truck.legacyImages && truck.legacyImages[`c${cycleIdx}_s${slotIdx}`]));
}

// CACHE + RENDERIZAÇÃO ESTÁVEL DO DASHBOARD
const DASHBOARD_CACHE_PREFIX = 'cb-frota-dashboard-v5:';
let lastDashboardRenderSignature = '';

function getDashboardCacheKey() {
    const uid = auth.currentUser ? auth.currentUser.uid : 'anonymous';
    return `${DASHBOARD_CACHE_PREFIX}${uid}:${activeYear}`;
}

function calculateDashboardStats() {
    const totalTrucks = rawFleetDocs.length;
    const notesTrucks = rawFleetDocs.filter(t => t.notes || t.transfer).length;
    const cycleStats = [0, 1, 2].map(() => ({ totalActive: 0, withPhoto: 0, units: {} }));
    const unitFleetCounts = Object.fromEntries(ALL_UNITS.map(unit => [unit, 0]));

    ALL_UNITS.forEach(unit => cycleStats.forEach(cycle => {
        cycle.units[unit] = { active: 0, withPhoto: 0 };
    }));

    rawFleetDocs.forEach(truck => {
        if (!truck.cycleUnits) return;

        // Frota da unidade = veículo único que pertence à unidade em pelo menos um ciclo.
        // Isso usa o mesmo conceito da navegação lateral e evita confundir 'frota da unidade' com 'ativos no ciclo'.
        const uniqueTruckUnits = new Set(truck.cycleUnits.filter(unit => unit && ALL_UNITS.includes(unit)));
        uniqueTruckUnits.forEach(unit => unitFleetCounts[unit]++);
        truck.cycleUnits.forEach((assignedUnit, cycleIdx) => {
            if (!assignedUnit || !ALL_UNITS.includes(assignedUnit)) return;
            cycleStats[cycleIdx].totalActive++;
            cycleStats[cycleIdx].units[assignedUnit].active++;
            if (truckHasPhotoInCycle(truck, cycleIdx)) {
                cycleStats[cycleIdx].withPhoto++;
                cycleStats[cycleIdx].units[assignedUnit].withPhoto++;
            }
        });
    });

    const globalActive = cycleStats.reduce((sum, cycle) => sum + cycle.totalActive, 0);
    const globalWithPhoto = cycleStats.reduce((sum, cycle) => sum + cycle.withPhoto, 0);

    return {
        version: 5,
        year: String(activeYear),
        totalTrucks,
        notesTrucks,
        unitFleetCounts,
        globalPercent: globalActive > 0 ? Math.round((globalWithPhoto / globalActive) * 100) : 0,
        cycles: cycleStats,
        savedAt: Date.now()
    };
}

function saveDashboardCache(stats) {
    if (!stats || !auth.currentUser) return;
    try {
        localStorage.setItem(getDashboardCacheKey(), JSON.stringify(stats));
    } catch (error) {
        console.warn('Não foi possível salvar o cache do dashboard:', error);
    }
}

function loadDashboardCache() {
    try {
        const cached = JSON.parse(localStorage.getItem(getDashboardCacheKey()) || 'null');
        if (!cached || cached.version !== 5 || String(cached.year) !== String(activeYear) || !Array.isArray(cached.cycles)) return null;
        return cached;
    } catch (error) {
        console.warn('Cache do dashboard inválido:', error);
        return null;
    }
}

function getDashboardSignature(stats) {
    if (!stats) return '';
    const stable = {
        year: stats.year,
        totalTrucks: stats.totalTrucks,
        notesTrucks: stats.notesTrucks,
        unitFleetCounts: stats.unitFleetCounts || {},
        globalPercent: stats.globalPercent,
        cycles: stats.cycles
    };
    return JSON.stringify(stable);
}

function getDashboardProgressStyle(percent) {
    const value = Math.max(0, Math.min(100, Number(percent) || 0));

    // Escala contínua com duas dimensões visuais:
    // 1) a tonalidade caminha do vermelho ao verde;
    // 2) quanto maior o percentual, mais escura/sólida fica a cor.
    // Isso torna 96, 97, 98, 99 e 100 perceptivelmente diferentes.
    let hue;
    if (value <= 70) {
        hue = (value / 70) * 28;
    } else if (value <= 90) {
        hue = 28 + ((value - 70) / 20) * 14;
    } else {
        hue = 42 + ((value - 90) / 10) * 78;
    }

    let lightness;
    if (value < 90) {
        lightness = 50 - (value / 90) * 5;       // 50% -> 45%
    } else {
        lightness = 52 - ((value - 90) / 10) * 22; // 90%=52%, 100%=30%
    }

    const roundedHue = Math.round(hue);
    const roundedLightness = Math.round(lightness);
    const barColor = `hsl(${roundedHue} 76% ${roundedLightness}%)`;
    const textColor = value >= 90
        ? `hsl(${roundedHue} 72% ${Math.max(24, roundedLightness - 8)}%)`
        : '#334155';
    const softLightness = value >= 90 ? 95 : 98;
    const softColor = `hsl(${roundedHue} 72% ${softLightness}%)`;

    return { value, barColor, textColor, softColor };
}

function renderDashboardStats(stats = null, force = false) {
    stats = stats || calculateDashboardStats();
    const signature = getDashboardSignature(stats);
    if (!force && signature === lastDashboardRenderSignature) return;
    lastDashboardRenderSignature = signature;

    document.getElementById('dash-year-label').innerText = stats.year;
    document.getElementById('dash-total-trucks').innerText = stats.totalTrucks;
    document.getElementById('dash-notes-trucks').innerText = stats.notesTrucks;
    document.getElementById('dash-photo-progress').innerText = `${stats.globalPercent}%`;

    const breakdown = document.getElementById('dash-cycles-breakdown');
    const nextHtml = [0, 1, 2].map(cycleIdx => {
        const cycle = stats.cycles[cycleIdx] || { totalActive: 0, withPhoto: 0, units: {} };
        const cyclePercent = cycle.totalActive > 0 ? Math.round((cycle.withPhoto / cycle.totalActive) * 100) : 0;
        const cycleProgressStyle = getDashboardProgressStyle(cyclePercent);
        return `
            <div class="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col gap-3">
                <div class="border-b pb-2 flex justify-between items-center">
                    <div>
                        <span class="text-xs font-black text-slate-800 uppercase tracking-wider">${cycleInfo[cycleIdx].label}</span>
                        <span class="text-[9px] font-bold text-slate-400 italic block">${cycleInfo[cycleIdx].range}</span>
                    </div>
                    <span class="text-xs font-black whitespace-nowrap px-2.5 py-1.5 rounded-lg border border-slate-200 transition-colors duration-300" style="color: ${cycleProgressStyle.textColor}; background-color: ${cycleProgressStyle.softColor};">${cyclePercent}% Progresso</span>
                </div>
                <div class="space-y-2.5">
                    ${ALL_UNITS.map(unit => {
                        const unitData = cycle.units[unit] || { active: 0, withPhoto: 0 };
                        const activeCount = unitData.active;
                        const photoCount = unitData.withPhoto;
                        const unitPercent = activeCount > 0 ? Math.round((photoCount / activeCount) * 100) : 0;
                        const unitProgressStyle = getDashboardProgressStyle(unitPercent);
                        const fleetCount = stats?.unitFleetCounts?.[unit] ?? rawFleetDocs.filter(t => Array.isArray(t.cycleUnits) && t.cycleUnits.includes(unit)).length;
                        return `
                            <div>
                                <div class="flex justify-between items-center text-[9px] font-bold text-slate-600 mb-0.5">
                                    <span>${unit}</span>
                                    <span class="font-black text-slate-800 flex items-center gap-1.5">
                                        <span>${photoCount}/${activeCount} no ciclo <span class="transition-colors duration-300" style="color: ${unitProgressStyle.barColor};">(${unitPercent}%)</span> <span class="text-slate-400 font-bold">• frota ${fleetCount}</span></span>
                                        <button onclick="event.stopPropagation(); openPhotoStatusModal(${cycleIdx}, '${unit.replace(/'/g, "\'")}')" class="text-slate-400 hover:text-slate-900 transition-colors" title="Ver veículos com e sem imagem">
                                            <i data-lucide="list-checks" class="w-3 h-3"></i>
                                        </button>
                                    </span>
                                </div>
                                <div class="w-full bg-slate-200 h-1.5 rounded-full overflow-hidden">
                                    <div class="h-full rounded-full transition-all duration-500" style="width: ${unitPercent}%; background-color: ${unitProgressStyle.barColor};"></div>
                                </div>
                            </div>
`;
                    }).join('')}
                </div>
            </div>`;
    }).join('');

    // Só troca o HTML quando os números realmente mudaram. Evita o flash visual causado por re-renderizações idênticas.
    if (breakdown.innerHTML !== nextHtml) breakdown.innerHTML = nextHtml;
    lucide.createIcons();
}

let currentPhotoStatusData = [];
let currentPhotoStatusCycleIdx = 0;
let currentPhotoStatusUnit = '';

function closePhotoStatusModal() {
    document.getElementById('photo-status-modal')?.classList.add('hidden');
}

document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !document.getElementById('photo-status-modal')?.classList.contains('hidden')) {
        closePhotoStatusModal();
    }
});

function openPhotoStatusModal(cycleIdx, unit) {
    currentPhotoStatusCycleIdx = cycleIdx;
    currentPhotoStatusUnit = unit;
    const vehicles = rawFleetDocs
        .filter(truck => truck.cycleUnits && truck.cycleUnits[cycleIdx] === unit)
        .sort((a, b) => parseInt(a.id) - parseInt(b.id));

    currentPhotoStatusData = vehicles.map(truck => ({
        id: truck.id,
        plate: truck.plate || '',
        model: truck.model || '',
        hasPhoto: truckHasPhotoInCycle(truck, cycleIdx)
    }));

    const cycleLabel = cycleInfo[cycleIdx]?.label || `Ciclo ${cycleIdx + 1}`;
    document.getElementById('photo-status-title').innerText = `${unit} • ${cycleLabel}`;
    document.getElementById('photo-status-subtitle').innerText = `Veículos desta unidade no ciclo selecionado`;
    document.getElementById('photo-status-total').innerText = currentPhotoStatusData.length;
    document.getElementById('photo-status-with').innerText = currentPhotoStatusData.filter(v => v.hasPhoto).length;
    document.getElementById('photo-status-without').innerText = currentPhotoStatusData.filter(v => !v.hasPhoto).length;
    document.getElementById('photo-status-search').value = '';
    renderPhotoStatusList('');
    document.getElementById('photo-status-modal').classList.remove('hidden');
    lucide.createIcons();
}

function filterPhotoStatusList(term) {
    renderPhotoStatusList(term);
}

function renderPhotoStatusList(term = '') {
    const normalized = String(term || '').trim().toUpperCase();
    const list = currentPhotoStatusData.filter(v => {
        if (!normalized) return true;
        return String(v.id).toUpperCase().includes(normalized) ||
               String(v.plate).toUpperCase().includes(normalized) ||
               String(v.model).toUpperCase().includes(normalized);
    });

    const container = document.getElementById('photo-status-list');
    const withPhoto = list.filter(v => v.hasPhoto);
    const withoutPhoto = list.filter(v => !v.hasPhoto);

    if (!list.length) {
        container.innerHTML = `
            <div class="h-full flex items-center justify-center">
                <div class="bg-white border border-slate-200 rounded-2xl px-6 py-8 text-center shadow-sm">
                    <i data-lucide="search-x" class="w-8 h-8 mx-auto text-slate-300 mb-2"></i>
                    <div class="text-[10px] font-black text-slate-500 uppercase">Nenhum veículo encontrado</div>
                    <div class="text-[9px] font-bold text-slate-400 mt-1">Tente outra placa, veículo ou modelo.</div>
                </div>
            </div>`;
        lucide.createIcons();
        return;
    }

    const renderVehicle = (vehicle) => `
        <button onclick="goToPhotoStatusVehicle('${String(vehicle.id).replace(/'/g, "\\'")}', currentPhotoStatusCycleIdx, currentPhotoStatusUnit)" class="photo-status-card w-full flex items-center gap-2 border ${vehicle.hasPhoto ? 'bg-emerald-50/80 border-emerald-200 hover:bg-emerald-100' : 'bg-red-50/80 border-red-200 hover:bg-red-100'} transition-colors text-left group">
            <div class="photo-status-icon ${vehicle.hasPhoto ? 'bg-emerald-500' : 'bg-red-500'} text-white flex items-center justify-center shrink-0 shadow-sm">
                <i data-lucide="${vehicle.hasPhoto ? 'image' : 'image-off'}"></i>
            </div>
            <div class="min-w-0 flex-1">
                <div class="flex items-center gap-1.5 min-w-0">
                    <span class="photo-status-card-title font-black text-slate-800 whitespace-nowrap">Veículo ${vehicle.id}</span>
                    <span class="text-[7px] font-black uppercase tracking-wide ${vehicle.hasPhoto ? 'text-emerald-700 bg-emerald-100' : 'text-red-700 bg-red-100'} px-1 py-0.5 rounded">${vehicle.hasPhoto ? 'COM' : 'SEM'}</span>
                </div>
                <div class="photo-status-card-meta font-bold text-slate-500 truncate">${vehicle.plate || 'Sem placa'}${vehicle.model ? ` • ${vehicle.model}` : ''}</div>
            </div>
            <i data-lucide="chevron-right" class="w-3 h-3 text-slate-300 group-hover:text-slate-500 shrink-0"></i>
        </button>`;

    const renderColumn = (title, count, items, type) => `
        <section class="photo-status-section bg-white border ${type === 'without' ? 'border-red-200' : 'border-emerald-200'} rounded-2xl overflow-hidden shadow-sm">
            <div class="shrink-0 px-3 py-2 ${type === 'without' ? 'bg-red-50 border-b border-red-100' : 'bg-emerald-50 border-b border-emerald-100'}">
                <div class="flex items-center justify-between gap-3">
                    <div class="flex items-center gap-2">
                        <div class="w-6 h-6 rounded-lg ${type === 'without' ? 'bg-red-500' : 'bg-emerald-500'} text-white flex items-center justify-center"><i data-lucide="${type === 'without' ? 'image-off' : 'image'}" class="w-3 h-3"></i></div>
                        <div>
                            <h4 class="text-[9px] font-black uppercase tracking-wider ${type === 'without' ? 'text-red-700' : 'text-emerald-700'}">${title}</h4>
                            <p class="text-[7px] font-bold text-slate-400">${type === 'without' ? 'Precisam receber uma imagem' : 'Imagem cadastrada no ciclo'}</p>
                        </div>
                    </div>
                    <span class="min-w-6 h-6 px-1.5 rounded-lg ${type === 'without' ? 'bg-red-500' : 'bg-emerald-500'} text-white flex items-center justify-center text-[9px] font-black">${count}</span>
                </div>
            </div>
            <div class="photo-status-items custom-scrollbar">
                ${items.length ? items.map(renderVehicle).join('') : `
                    <div class="h-full min-h-32 flex flex-col items-center justify-center text-center px-4">
                        <i data-lucide="${type === 'without' ? 'check-circle-2' : 'image-off'}" class="w-7 h-7 ${type === 'without' ? 'text-emerald-300' : 'text-slate-300'} mb-2"></i>
                        <span class="text-[9px] font-black uppercase ${type === 'without' ? 'text-emerald-600' : 'text-slate-400'}">${type === 'without' ? 'Todos estão com imagem' : 'Nenhum veículo com imagem'}</span>
                    </div>`}
            </div>
        </section>`;

    container.innerHTML = `
        <div class="photo-status-columns">
            ${renderColumn('Sem imagem', withoutPhoto.length, withoutPhoto, 'without')}
            ${renderColumn('Com imagem', withPhoto.length, withPhoto, 'with')}
        </div>`;
    lucide.createIcons();
}

function goToPhotoStatusVehicle(vehicleId, cycleIdx = 0, unit = '') {
    const truck = rawFleetDocs.find(t => String(t.id) === String(vehicleId));
    if (!truck) return;
    closePhotoStatusModal();
    searchTerm = '';
    const searchInput = document.getElementById('search-input');
    if (searchInput) searchInput.value = '';
    activeUnit = unit || truck.cycleUnits?.[cycleIdx] || truck.cycleUnits?.find(Boolean) || activeUnit;
    const list = getCurrentFilteredList();
    const index = list.findIndex(t => String(t.id) === String(vehicleId));
    if (index >= 0) {
        currentIndex = index;
        render(true);
    }
}

function updateDashboardCacheFromCurrentFleet() {
    if (!rawFleetDocs.length) return;
    const freshStats = calculateDashboardStats();
    saveDashboardCache(freshStats);
    const modal = document.getElementById('dashboard-modal');
    if (modal && !modal.classList.contains('hidden')) renderDashboardStats(freshStats);
}

async function hydrateMissingDashboardSummaries() {
    const missing = rawFleetDocs.filter(truck => !truck.photoSummary);
    if (!missing.length) return;

    const concurrency = 4;
    let cursor = 0;
    async function worker() {
        while (cursor < missing.length) {
            const truck = missing[cursor++];
            await refreshTruckPhotoSummary(truck.docId);
        }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, missing.length) }, worker));
    updateDashboardCacheFromCurrentFleet();
}

function openDashboardModal() {
    const modal = document.getElementById('dashboard-modal');
    modal.classList.remove('hidden');

    // 1) Abre instantaneamente com a última fotografia estatística salva.
    const cached = loadDashboardCache();
    if (cached) renderDashboardStats(cached, true);

    // 2) Compara com os dados vivos já carregados e só redesenha se algo realmente mudou.
    if (rawFleetDocs.length) {
        const fresh = calculateDashboardStats();
        saveDashboardCache(fresh);
        renderDashboardStats(fresh, !cached);
    }

    // 3) Completa resumos antigos em segundo plano. O listener da frota não redesenha mais a tela principal
    // quando a única mudança é photoSummary, eliminando o pisca-pisca.
    hydrateMissingDashboardSummaries();
}

        function closeDashboardModal() {
            document.getElementById('dashboard-modal').classList.add('hidden');
        }

        // COMPRESSÃO DE IMAGEM
        function compressImage(file, maxWidth = 1000, quality = 0.75) {
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.readAsDataURL(file);
                reader.onload = (e) => {
                    const img = new Image();
                    img.src = e.target.result;
                    img.onload = () => {
                        const canvas = document.createElement('canvas');
                        let width = img.width;
                        let height = img.height;

                        if (width > maxWidth) {
                            height = Math.round((height * maxWidth) / width);
                            width = maxWidth;
                        }

                        canvas.width = width;
                        canvas.height = height;
                        const ctx = canvas.getContext('2d');
                        ctx.drawImage(img, 0, 0, width, height);

                        resolve(canvas.toDataURL('image/jpeg', quality));
                    };
                    img.onerror = (err) => reject(err);
                };
                reader.onerror = (err) => reject(err);
            });
        }

// REGISTRO DE AUDITORIA NO FIRESTORE
        async function logAuditAction(truckDocId, actionDescription) {
            try {
                const userEmail = auth.currentUser ? auth.currentUser.email : "ADM Anônimo";
                await db.collection("fleet").doc(truckDocId).collection("audit_logs").add({
                    user: userEmail,
                    action: actionDescription,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });
            } catch (e) { console.error("Erro ao registrar log:", e); }
        }

        async function openAuditModal() {
            const list = getCurrentFilteredList();
            const truck = list[currentIndex];
            if (!truck) return;

            document.getElementById('audit-modal').classList.remove('hidden');
            const logsContainer = document.getElementById('audit-logs-list');
            logsContainer.innerHTML = `<span class="text-slate-400 text-center block py-4 animate-pulse">Carregando logs do veículo ${truck.id}...</span>`;

            try {
                const snapshot = await db.collection("fleet").doc(truck.docId).collection("audit_logs")
                    .orderBy("timestamp", "desc").limit(20).get();

                if (snapshot.empty) {
                    logsContainer.innerHTML = `<span class="text-slate-400 text-center block py-4">Nenhum registro de alteração encontrado para este veículo.</span>`;
                    return;
                }

                logsContainer.innerHTML = snapshot.docs.map(doc => {
                    const data = doc.data();
                    const dateStr = data.timestamp ? new Date(data.timestamp.toDate()).toLocaleString('pt-BR') : "Recente";
                    return `
                        <div class="p-2.5 bg-slate-50 rounded-xl border border-slate-100 flex flex-col gap-1">
                            <div class="flex justify-between items-center">
                                <span class="font-bold text-slate-800">${data.user}</span>
                                <span class="text-[8px] text-slate-400 font-bold">${dateStr}</span>
                            </div>
                            <span class="text-slate-600 font-medium">${data.action}</span>
                        </div>
                    `;
                }).join('');
            } catch (err) { logsContainer.innerHTML = `<span class="text-red-500 text-center block py-4">Erro ao carregar logs.</span>`; }
        }

        function closeAuditModal() { document.getElementById('audit-modal').classList.add('hidden'); }

        let unsubscribeFleet = null;

        function getFleetUiSignature(docs) {
            return JSON.stringify((docs || []).map(t => ({
                docId: t.docId,
                id: t.id,
                cycleUnits: t.cycleUnits,
                active: t.active,
                transfer: t.transfer,
                notes: t.notes,
                plate: t.plate,
                model: t.model,
                type: t.type,
                vehicleYear: t.vehicleYear
            })).sort((a, b) => String(a.docId).localeCompare(String(b.docId))));
        }

        function loadDataFromFirebase() {
            const yearSelector = document.getElementById('year-selector');
            yearSelector.innerHTML = availableYears.map(y => `<option value="${y}" ${y === activeYear ? 'selected' : ''} class="text-slate-900">${y}</option>`).join('');
            document.getElementById('label-title-year').innerText = `IMAGENS FROTA ${activeYear}`;

            if (unsubscribeFleet) unsubscribeFleet();

            unsubscribeFleet = db.collection("fleet")
                .where("year", "==", activeYear)
                .onSnapshot(snapshot => {
                    const nextFleetDocs = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        let cycleUnits = data.cycleUnits;
                        if (!cycleUnits) {
                            const defaultUnit = data.unit || "CB NORTE";
                            cycleUnits = [
                                data.active && data.active[0] ? defaultUnit : null,
                                data.active && data.active[1] ? defaultUnit : null,
                                data.active && data.active[2] ? defaultUnit : null
                            ];
                        }

                        const truckId = doc.id.split("_")[1] || doc.id;
                        const spreadsheetData = (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[truckId]) || {};
                        nextFleetDocs.push({
                            id: truckId,
                            docId: doc.id,
                            cycleUnits: cycleUnits,
                            active: data.active || [true, true, true],
                            transfer: data.transfer || "",
                            notes: data.notes || "",
                            plate: data.plate || spreadsheetData.plate || "",
                            model: data.model || spreadsheetData.model || "",
                            type: data.type || spreadsheetData.type || "",
                            vehicleYear: data.vehicleYear || spreadsheetData.year || "",
                            photoSummary: data.photoSummary || null,
                            legacyImages: data.images || {}
                        });
                    });

                    const oldUiSignature = getFleetUiSignature(rawFleetDocs);
                    const newUiSignature = getFleetUiSignature(nextFleetDocs);
                    const mainUiChanged = oldUiSignature !== newUiSignature;
                    rawFleetDocs = nextFleetDocs;

                    // O dashboard e seu cache acompanham todo snapshot, inclusive alterações feitas por outro usuário.
                    // Isso não redesenha a tela principal quando só o resumo de fotos mudou.
                    updateDashboardCacheFromCurrentFleet();

                    if (mainUiChanged) {
                        restoreNavigationPositionAfterFleetLoad();
                        render();
                    }
                });
        }

        let unsubscribeSlots = null;
        function listenToTruckSlots(truckDocId) {
            if (unsubscribeSlots) unsubscribeSlots();
            activeTruckSlots = {};

            if (!truckDocId) return;

            unsubscribeSlots = db.collection("fleet").doc(truckDocId).collection("slots")
                .onSnapshot(snapshot => {
                    activeTruckSlots = {};
                    snapshot.forEach(doc => {
                        activeTruckSlots[doc.id] = doc.data().url || doc.data().base64;
                    });
                    const currentTruck = rawFleetDocs.find(t => t.docId === truckDocId);
                    if (currentTruck) currentTruck.photoSummary = buildPhotoSummaryFromSlotKeys(Object.keys(activeTruckSlots), currentTruck.legacyImages);
                    renderSlotsGridOnly();
                });
        }

        function loadYearsList() {
            db.collection("settings").doc("years").onSnapshot(doc => {
                if (doc.exists && doc.data().list) {
                    availableYears = doc.data().list;
                } else {
                    db.collection("settings").doc("years").set({ list: ["2025"] });
                    availableYears = ["2025"];
                }

                if (pendingNavigationState && availableYears.includes(pendingNavigationState.year)) {
                    activeYear = pendingNavigationState.year;
                } else if (!availableYears.includes(activeYear) && availableYears.length) {
                    activeYear = availableYears[availableYears.length - 1];
                }

                loadDataFromFirebase();
            });
        }

        async function syncFleetDataForActiveYear() {
            if (!isAdmin) return;
            const fleetMap = window.FLEET_DATA_MAP || {};
            const entries = Object.entries(fleetMap);
            if (!entries.length) {
                showToast("Dados da frota não encontrados.", "error");
                return;
            }

            if (!confirm(`Sincronizar placa, modelo, tipo e ano da planilha nos veículos de ${activeYear}? Nenhum outro campo será alterado.`)) return;

            try {
                const snapshot = await db.collection('fleet').where('year', '==', activeYear).get();
                let updated = 0;
                let ignored = 0;
                let batch = db.batch();
                let batchSize = 0;
                const commits = [];

                for (const doc of snapshot.docs) {
                    const truckId = doc.id.split('_')[1] || doc.id;
                    const info = fleetMap[truckId];
                    if (!info) { ignored++; continue; }

                    const current = doc.data();
                    const payload = {
                        plate: info.plate || "",
                        model: info.model || "",
                        type: info.type || "",
                        vehicleYear: info.year || ""
                    };

                    const isSame =
                        (current.plate || '').toUpperCase() === payload.plate.toUpperCase() &&
                        (current.model || '') === payload.model &&
                        (current.type || '') === payload.type &&
                        String(current.vehicleYear || '') === String(payload.vehicleYear || '');
                    if (isSame) continue;

                    batch.set(doc.ref, payload, { merge: true });
                    batchSize++;
                    updated++;

                    if (batchSize >= 450) {
                        commits.push(batch.commit());
                        batch = db.batch();
                        batchSize = 0;
                    }
                }

                if (batchSize > 0) commits.push(batch.commit());
                await Promise.all(commits);
                showToast(`Dados da frota sincronizados: ${updated} atualizados${ignored ? `, ${ignored} sem correspondência` : ''}.`);
            } catch (error) {
                console.error('Erro ao sincronizar dados da frota:', error);
                showToast('Erro ao sincronizar dados da frota.', 'error');
            }
        }

        async function addNewYear() {
            if (!isAdmin) return;
            const newYear = prompt("Digite o novo Ano (Ex: 2026):");
            if (!newYear || availableYears.includes(newYear)) return;

            const baseYear = activeYear; 
            const wantToClone = confirm(`Deseja clonar os caminhões de ${baseYear} para ${newYear}?`);

            availableYears.push(newYear);
            availableYears.sort((a, b) => parseInt(a) - parseInt(b));
            await db.collection("settings").doc("years").set({ list: availableYears });

            if (wantToClone) {
                try {
                    const snapshot = await db.collection("fleet").where("year", "==", baseYear).get();
                    for (const doc of snapshot.docs) {
                        const originalData = doc.data();
                        const truckId = doc.id.split("_")[1];
                        const newDocId = `${newYear}_${truckId}`;
                        
                        await db.collection("fleet").doc(newDocId).set({
                            year: newYear,
                            cycleUnits: originalData.cycleUnits || [originalData.unit, originalData.unit, originalData.unit],
                            active: originalData.active || [true, true, true],
                            transfer: originalData.transfer || "",
                            notes: originalData.notes || "",
                            plate: originalData.plate || (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[truckId]?.plate) || "",
                            model: originalData.model || (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[truckId]?.model) || "",
                            type: originalData.type || (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[truckId]?.type) || "",
                            vehicleYear: originalData.vehicleYear || (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[truckId]?.year) || "",
                            photoSummary: originalData.photoSummary || null
                        });
                    }
                } catch (err) { showToast("Erro ao clonar dados", "error"); }
            }

            activeYear = newYear;
            currentIndex = 0;
            loadDataFromFirebase();
            showToast(`Ano ${newYear} criado!`);
        }

        function changeYear(year) {
            activeYear = year;
            currentIndex = 0;
            loadDataFromFirebase();
        }

        async function addNewTruck() {
            const id = prompt("Digite o número do novo veículo:");
            if (!id) return;
            
            const fullDocId = `${activeYear}_${id}`;
            await db.collection("fleet").doc(fullDocId).set({
                year: activeYear,
                cycleUnits: [activeUnit, activeUnit, activeUnit],
                active: [true, true, true],
                transfer: "",
                notes: "",
                plate: (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[id]?.plate) || "",
                model: (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[id]?.model) || "",
                type: (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[id]?.type) || "",
                vehicleYear: (window.FLEET_DATA_MAP && window.FLEET_DATA_MAP[id]?.year) || "",
                photoSummary: null
            });
            await logAuditAction(fullDocId, `Veículo ${id} cadastrado no sistema (${activeYear}).`);
            showToast(`Veículo ${id} adicionado!`);
        }

        async function saveTruckMetadata() {
            const list = getCurrentFilteredList();
            const truck = list[currentIndex];
            if (!truck) return;

            const newPlate = document.getElementById('edit-plate').value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
            const newTransfer = document.getElementById('edit-transfer').value;
            const newNotes = document.getElementById('edit-notes').value;

            await db.collection("fleet").doc(truck.docId).update({
                plate: newPlate,
                transfer: newTransfer,
                notes: newNotes
            });

            await logAuditAction(truck.docId, `Atualizou dados (Placa: "${newPlate}", Transf: "${newTransfer}", Obs: "${newNotes}")`);
            showToast("Informações salvas!");
        }

        async function deleteTruck() {
            const list = getCurrentFilteredList();
            const truck = list[currentIndex];
            if (!truck || !isAdmin) return;

            if (confirm(`Atenção: Tem certeza que deseja apagar o veículo ${truck.id} do ano de ${activeYear}?`)) {
                await db.collection("fleet").doc(truck.docId).delete();
                currentIndex = 0;
                render();
                showToast(`Veículo ${truck.id} excluído!`);
            }
        }

        async function setCycleUnit(cycleIdx, newUnit) {
            if (!isAdmin) return;
            const list = getCurrentFilteredList();
            const truck = list[currentIndex];
            if (!truck) return;

            let updatedCycleUnits = [...truck.cycleUnits];
            updatedCycleUnits[cycleIdx] = newUnit;

            await db.collection("fleet").doc(truck.docId).update({
                cycleUnits: updatedCycleUnits
            });

            await logAuditAction(truck.docId, `Alterou ${cycleIdx + 1}º ciclo para a unidade "${newUnit || 'Inativo'}"`);
            showToast(`Ciclo alterado!`);
        }

        function triggerImageUpload(cycleIdx, slotIdx) {
            if (!isAdmin) return;
            const fileInput = document.getElementById(`file-input-${cycleIdx}-${slotIdx}`);
            if (!fileInput) return;
            fileInput.value = '';
            fileInput.oncancel = () => { document.body.focus(); };
            fileInput.click();
        }

        // ENVIO INDIVIDUAL
        async function uploadFileToSlot(file, cycleIdx, slotIdx, truckDocId) {
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                showToast("Selecione uma imagem válida!", "error");
                return;
            }

            const container = document.getElementById(`slot-container-${cycleIdx}-${slotIdx}`);
            const originalHTML = container ? container.innerHTML : ""; 
            if (container) container.innerHTML = `<span class="text-[8px] font-bold text-slate-400 animate-pulse">PROCESSANDO...</span>`;

            try {
                let finalBase64 = "";

                if (parseInt(activeYear) >= 2026) {
                    finalBase64 = await compressImage(file, activeUnit);
                } else {
                    finalBase64 = await compressImage(file);
                }

                const slotDocId = `c${cycleIdx}_s${slotIdx}`;
                
                await db.collection("fleet").doc(truckDocId).collection("slots").doc(slotDocId).set({
                    base64: finalBase64,
                    year: activeYear,
                    cycleIdx: cycleIdx,
                    truckDocId: truckDocId,
                    updatedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
                await refreshTruckPhotoSummary(truckDocId);

                await logAuditAction(truckDocId, `Adicionou/Atualizou foto no Ciclo ${cycleIdx + 1}, Foto ${slotIdx} (${activeYear})`);
                
                if (parseInt(activeYear) >= 2026) {
                    showToast("Imagem salva com sucesso!");
                } else {
                    showToast("Imagem salva com sucesso!");
                }
            } catch (error) {
                console.error("Erro no envio:", error);
                showToast("Erro ao salvar imagem", "error");
                if (container) container.innerHTML = originalHTML;
            }
        }

        function handleFileUpload(input, cycleIdx, slotIdx, truckDocId) {
            if (input.files && input.files[0]) {
                uploadFileToSlot(input.files[0], cycleIdx, slotIdx, truckDocId);
            }
        }

        async function deleteImage(e, cycleIdx, slotIdx, truckDocId) {
            e.stopPropagation();
            if (!isAdmin) return;

            try {
                const slotDocId = `c${cycleIdx}_s${slotIdx}`;
                await db.collection("fleet").doc(truckDocId).collection("slots").doc(slotDocId).delete();
                
                const imageKey = `images.c${cycleIdx}_s${slotIdx}`;
                await db.collection("fleet").doc(truckDocId).update({
                    [imageKey]: firebase.firestore.FieldValue.delete()
                }).catch(() => {});
                await refreshTruckPhotoSummary(truckDocId);

                await logAuditAction(truckDocId, `Removeu a foto do Ciclo ${cycleIdx + 1}, Foto ${slotIdx}`);
                showToast("Imagem removida!");
            } catch (err) {
                showToast("Erro ao remover", "error");
            }
        }

        function handleDragOver(e) { e.preventDefault(); if (isAdmin) e.currentTarget.classList.add('drag-over-slot'); }
        function handleDragLeave(e) { e.preventDefault(); e.currentTarget.classList.remove('drag-over-slot'); }
        function handleDrop(e, cycleIdx, slotIdx, truckDocId) {
            e.preventDefault(); e.currentTarget.classList.remove('drag-over-slot');
            if (isAdmin && e.dataTransfer.files && e.dataTransfer.files[0]) {
                uploadFileToSlot(e.dataTransfer.files[0], cycleIdx, slotIdx, truckDocId);
            }
        }

        function handleImgLoad(img) { img.classList.remove('opacity-0'); img.classList.add('opacity-100'); }
        function handleImgError(img) { img.style.display = 'none'; }
        
        // ZOOM NÍTIDO HABILITADO
        function openZoom(src) { 
            if (!src) return; 
            document.getElementById('lightbox-modal').style.display = 'flex'; 
            document.getElementById('lightbox-img').src = src; 
        }

        function toggleComparison() {
            document.body.classList.toggle('comparison-active');
            const btn = document.getElementById('btn-comparison');
            btn.innerHTML = document.body.classList.contains('comparison-active')
                ? `<i data-lucide="layout-list" class="w-3.5 h-3.5"></i> Sair Comparação (C)`
                : `<i data-lucide="layout-grid" class="w-3.5 h-3.5"></i> Comparar Ciclos (C)`;
            lucide.createIcons();
        }

        function getCurrentFilteredList() {
            return rawFleetDocs.filter(truck => {
                const normalizedSearch = searchTerm.toUpperCase().replace(/[^A-Z0-9]/g, '');
                const matchesSearch = truck.id.includes(searchTerm) || (truck.plate || '').toUpperCase().includes(normalizedSearch);
                const hasCycleInUnit = truck.cycleUnits && truck.cycleUnits.includes(activeUnit);
                return matchesSearch && hasCycleInUnit;
            }).sort((a, b) => parseInt(a.id) - parseInt(b.id));
        }

        let currentTruckDocId = null;

        function render(isUnitJump = false) {
            const list = getCurrentFilteredList();
            const truck = list[currentIndex] || list[0] || { id: "---", docId:"", cycleUnits: [null, null, null], transfer:"", notes:"" };
            
            if (truck.docId !== currentTruckDocId) {
                currentTruckDocId = truck.docId;
                listenToTruckSlots(truck.docId);
            }

            if (isAdmin && list.length > 0) {
                document.getElementById('edit-plate').value = truck.plate || "";
                document.getElementById('edit-transfer').value = truck.transfer || "";
                document.getElementById('edit-notes').value = truck.notes || "";
            }

            const animatedContent = document.getElementById('animated-content');
            if(animatedContent) {
                animatedContent.classList.remove('slide-up-active'); void animatedContent.offsetWidth; animatedContent.classList.add('slide-up-active');
            }
            
            const display = document.getElementById('main-display');
            if (isUnitJump) { display.classList.add('unit-jump-glow'); setTimeout(() => display.classList.remove('unit-jump-glow'), 1500); }
            
            document.getElementById('unit-selector').innerHTML = ALL_UNITS.map(name => `<button onclick="changeUnit('${name}')" class="px-3 py-1.5 rounded-md transition-all ${activeUnit === name ? 'bg-white text-[#E30613] shadow-md scale-105' : 'text-white/60 hover:text-white'}">${name}</button>`).join('');
            document.getElementById('total-counter').innerText = `${list.length} veículos`;
            
            const truckList = document.getElementById('truck-list');
            truckList.innerHTML = list.map((t, i) => `<button data-truck-index="${i}" onclick="setStep(${i})" class="w-full group flex flex-col items-center p-2.5 rounded-xl transition-all duration-200 ${truck.id === t.id ? 'bg-[#E30613] text-white shadow-lg scale-105' : 'hover:bg-white text-slate-400'}"><span class="text-[11px] font-black">${t.id}</span></button>`).join('');

            requestAnimationFrame(() => {
                const activeTruckButton = truckList.querySelector(`[data-truck-index="${currentIndex}"]`);
                if (activeTruckButton) activeTruckButton.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' });
            });
            
            document.getElementById('current-id').innerText = truck.id;
            document.getElementById('current-plate').innerText = `PLACA ${truck.plate || '---'}`;
            document.getElementById('current-model').innerText = `MODELO ${truck.model || '---'}`;
            document.getElementById('current-type').innerText = `TIPO ${truck.type || '---'}`;
            document.getElementById('current-vehicle-year').innerText = `ANO ${truck.vehicleYear || '---'}`;
            document.getElementById('current-unit-label').innerText = activeUnit;
            document.getElementById('page-indicator').innerText = `${list.length > 0 ? currentIndex + 1 : 0} de ${list.length}`;
            
            const notesContainer = document.getElementById('notes-container');
            notesContainer.innerHTML = '';
            if (truck.transfer) notesContainer.innerHTML += `<div class="bg-red-600 text-white px-4 py-0.5 rounded shadow-sm text-[10px] font-black uppercase"><i data-lucide="arrow-right-left" class="w-2.5 h-2.5 inline mr-1"></i>${truck.transfer}</div>`;
            if (truck.notes) notesContainer.innerHTML += `<div class="bg-slate-900 text-white px-4 py-0.5 rounded text-[10px] font-black uppercase"><i data-lucide="wrench" class="w-2.5 h-2.5 inline mr-1 text-[#E30613]"></i>${truck.notes}</div>`;
            
            renderSlotsGridOnly();
            document.getElementById('pagination-dots').innerHTML = list.map((_, i) => `<div class="h-1 rounded-full ${currentIndex === i ? 'w-4 bg-[#E30613]' : 'w-1 bg-slate-200'}"></div>`).join('');
            saveNavigationState();
            lucide.createIcons();
        }

        // RENDERIZAÇÃO INTELIGENTE DE CICLOS (PRESERVA A POSIÇÃO DAS COLUNAS)
        function renderSlotsGridOnly() {
            const list = getCurrentFilteredList();
            const truck = list[currentIndex] || { id: "---", docId:"", cycleUnits: [null, null, null], legacyImages:{} };

            document.getElementById('cycles-grid').innerHTML = [0, 1, 2].map(i => {
                const assignedUnit = truck.cycleUnits ? truck.cycleUnits[i] : null;
                const isActiveInThisUnit = (assignedUnit === activeUnit);
                const isCompletelyInactive = !assignedUnit || assignedUnit === "Inativo";

                // Se o ciclo for inativo para o veículo, mantém o espaço na coluna mas esconde o conteúdo (visibility: hidden)
                if (!isAdmin && isCompletelyInactive) {
                    return `
                        <div class="flex flex-col rounded-3xl border-2 border-transparent bg-transparent invisible">
                            <div class="px-4 py-2 border-b border-transparent">
                                <span class="text-[9px] font-black text-transparent uppercase tracking-widest">${cycleInfo[i].label}</span>
                            </div>
                        </div>`;
                }
                
                return `
                    <div class="flex flex-col rounded-3xl border-2 transition-all duration-300 overflow-hidden bg-white border-slate-200 shadow-md">
                        <div class="px-4 py-2 flex justify-between items-center ${isActiveInThisUnit ? 'bg-[#E30613]/5' : 'bg-slate-100/80'}">
                            <div>
                                <span class="text-[9px] font-black text-slate-800 uppercase tracking-widest">${cycleInfo[i].label}</span>
                                <span class="text-[7px] font-bold text-slate-400 block italic">${cycleInfo[i].range}</span>
                            </div>
                            
                            ${isAdmin ? `
                                <select onchange="setCycleUnit(${i}, this.value)" class="text-[8px] font-bold border rounded px-1 py-0.5 bg-white text-slate-800 outline-none">
                                    <option value="">(Nenhuma / Inativo)</option>
                                    ${ALL_UNITS.map(u => `<option value="${u}" ${u === assignedUnit ? 'selected' : ''}>${u}</option>`).join('')}
                                </select>
                            ` : `
                                ${isActiveInThisUnit ? '<i data-lucide="check-circle-2" class="w-3.5 h-3.5 text-emerald-500"></i>' : `<span class="text-[8px] font-black text-red-600 bg-red-50 border border-red-200 px-2 py-0.5 rounded-full uppercase italic">${assignedUnit ? 'EM ' + assignedUnit : 'INATIVO'}</span>`}
                            `}
                        </div>
                        <div class="flex-1 p-2 grid grid-cols-2 grid-rows-2 gap-2 overflow-hidden">
                            ${[1, 2, 3, 4].map(s => {
                                const slotKey = `c${i}_s${s}`;
                                const imgUrl = activeTruckSlots[slotKey] || (truck.legacyImages ? truck.legacyImages[slotKey] : "") || "";
                                const canUpload = isAdmin && isActiveInThisUnit;
                                return `
                                    <div id="slot-container-${i}-${s}" 
                                         ${canUpload ? `onclick="event.stopPropagation(); triggerImageUpload(${i}, ${s})"` : ''} 
                                         ondragover="handleDragOver(event)" 
                                         ondragleave="handleDragLeave(event)" 
                                         ondrop="handleDrop(event, ${i}, ${s}, '${truck.docId}')"
                                         class="image-slot bg-slate-50 rounded-2xl border border-slate-200 relative group overflow-hidden ${canUpload ? 'border-blue-300 hover:bg-blue-50 cursor-pointer' : 'cursor-zoom-in'} flex items-center justify-center shadow-sm">
                                        
                                        ${imgUrl ? `<img src="${imgUrl}" onload="handleImgLoad(this)" onerror="handleImgError(this)" onclick="openZoom('${imgUrl}')" class="opacity-0 max-w-full max-h-full object-contain z-10 transition-transform duration-300 group-hover:scale-105" alt="Foto da frota">` : ''}
                                        
                                        <i data-lucide="${canUpload ? 'upload-cloud' : 'image'}" class="img-placeholder-icon absolute w-5 h-5 ${canUpload ? 'text-blue-400' : 'text-slate-200'} z-0"></i>
                                        
                                        ${isAdmin && imgUrl ? `<button onclick="deleteImage(event, ${i}, ${s}, '${truck.docId}')" title="Excluir imagem" class="absolute top-1.5 right-1.5 bg-red-600/90 hover:bg-red-700 text-white p-1 rounded-full z-30 transition-all shadow-md"><i data-lucide="trash-2" class="w-3 h-3"></i></button>` : ''}
                                        
                                        ${canUpload ? `<input type="file" id="file-input-${i}-${s}" accept="image/*" class="hidden" onclick="event.stopPropagation();" onchange="handleFileUpload(this, ${i}, ${s}, '${truck.docId}')">` : ''}
                                    </div>`;
                            }).join('')}
                        </div>
                    </div>`;
            }).join('');
            lucide.createIcons();
        }

        function changeUnit(unit) { activeUnit = unit; currentIndex = 0; render(true); }
        function setStep(i) { currentIndex = i; render(); }

        document.getElementById('prev-btn').onclick = () => { 
            if (currentIndex > 0) { currentIndex--; render(); } 
        };
        
        document.getElementById('next-btn').onclick = () => { 
            const list = getCurrentFilteredList(); 
            if (currentIndex < list.length - 1) { currentIndex++; render(); } 
        };
        
        document.getElementById('search-input').oninput = (e) => {
            const val = e.target.value.trim(); searchTerm = val; currentIndex = 0;
            if (val.length >= 2) { 
                const normalizedVal = val.toUpperCase().replace(/[^A-Z0-9]/g, '');
                for (const u of ALL_UNITS) {
                    const unitList = rawFleetDocs.filter(t => {
                        const matches = t.id.includes(val) || (t.plate || '').toUpperCase().includes(normalizedVal);
                        return matches && t.cycleUnits && t.cycleUnits.includes(u);
                    }).sort((a, b) => parseInt(a.id) - parseInt(b.id));
                    const exactIdx = unitList.findIndex(t => t.id === val || (t.plate || '').toUpperCase() === normalizedVal);
                    if (exactIdx !== -1) { activeUnit = u; currentIndex = exactIdx; render(); return; }
                } 
            }
            render();
        };

        window.addEventListener('keydown', (e) => {
            if (!e || !e.key) return;
            if (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA') return;

            const key = e.key.toLowerCase();
            if (key === 'escape') {
                if (document.body.classList.contains('comparison-active')) { toggleComparison(); return; }
                document.getElementById('lightbox-modal').style.display = 'none';
                closeAuditModal();
                closeDashboardModal();
                closeEditorsModal();
            }
            else if (key === 'c') { toggleComparison(); }
            else if (e.key === 'ArrowRight') { document.getElementById('next-btn').click(); }
            else if (e.key === 'ArrowLeft') { document.getElementById('prev-btn').click(); }
        });

        function toggleFullscreen() { if (!document.fullscreenElement) document.documentElement.requestFullscreen(); else document.exitFullscreen(); }

        if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
                navigator.serviceWorker.register('./sw.js')
                    .then(() => console.log('PWA Service Worker Ativo!'))
                    .catch(err => console.log('Erro ao registrar PWA:', err));
            });
        }
    




  // Reset de estado injetado
  document.addEventListener('DOMContentLoaded', () => {
    localStorage.removeItem('isEditMode');
  });
