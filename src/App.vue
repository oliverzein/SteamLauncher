<template>
  <div id="app" class="app">
    <header class="header">
      <div class="header-logo">
        <span class="logo-text">SteamLauncher</span>
        <span class="version-tag">v{{ appVersion }}</span>
      </div>
      <div class="header-actions">
        <button @click="refresh" class="app-refresh-btn" title="Refresh library">⟳</button>
        <button @click="openSettings" class="app-settings-btn" title="Settings">⚙️</button>
      </div>
    </header>
    
    <main class="main">
      <div v-if="loading" class="loading">
        <p>Loading Steam games...</p>
      </div>
      
      <div v-else-if="games.length === 0" class="no-games">
        <p>No Steam games found. Check your Steam compatdata path in settings.</p>
      </div>
      
      <div v-else class="game-grid" @dragover.prevent="onGridDragOver" @drop="onGridDrop">
        <div 
          v-for="(game, index) in games" 
          :key="game.steamID"
          :class="gameCardClasses(index)"
          draggable="true"
          @dragstart="onCardDragStart(index, $event)"
          @dragover="onCardDragOver(index, $event)"
          @dragleave="onCardDragLeave(index)"
          @drop="onCardDrop(index, $event)"
          @dragend="onCardDragEnd"
        >
          <img 
            v-if="game.icon" 
            :src="game.icon" 
            :alt="game.name" 
            class="game-icon"
            draggable="false"
            @click="launchGame(index)"
          />
          <div class="game-info">
            <span class="game-title">{{ game.name }}</span>
            <div class="game-actions">
              <button v-if="game.updateAvailable" @click.stop="triggerUpdate(game.steamID)" class="game-update-btn" title="Update available" aria-label="Update game">
                <img :src="upgradeIcon" alt="Update" />
              </button>
              <button @click.stop="startSteamOnly(index)" title="Start Steam for this game account" class="start-steam-icon" aria-label="Start Steam">
                <img :src="steamIcon" alt="Steam" />
              </button>
              <button @click="toggleHidden(index)" :title="game.hidden ? 'Unhide game' : 'Hide game'" class="game-hide-icon">{{ game.hidden ? '👁️‍🗨️' : '👁️' }}</button>
              <button @click="configureGame(index)" class="game-settings-icon">⚙️</button>
            </div>
          </div>
          <div v-if="isLaunching(index)" class="launching-overlay">
            <div class="spinner"></div>
            <div class="launching-text">Launching…</div>
          </div>
          <div v-if="isUpdating(game.steamID)" class="updating-overlay" @click.stop>
            <div class="updating-info">
              <span class="updating-status">{{ getUpdateStatusText(game.steamID) }}</span>
              <div class="progress-bar-track">
                <div class="progress-bar-fill" :style="{ width: getUpdateProgress(game.steamID) + '%' }"></div>
              </div>
              <span class="updating-percentage">{{ getUpdateProgress(game.steamID) }}%</span>
            </div>
            <button class="update-cancel-btn" @click.stop="cancelUpdate(game.steamID)" title="Cancel update">✕</button>
          </div>
        </div>
      </div>
    </main>

    <div v-if="showNotesModal" class="modal-backdrop">
      <div class="modal">
        <div class="modal-header">
          <h3 class="modal-title">Notes for {{ modalGameName }}</h3>
          <button class="modal-close" @click="cancelLaunch" aria-label="Close">✕</button>
        </div>
        <div class="notes-content">{{ notesText }}</div>
      </div>
    </div>

    <!-- Steam Guard Modal -->
    <div v-if="showSteamGuardModal" class="modal-backdrop">
      <div class="modal steam-guard-modal">
        <div class="modal-header">
          <h3 class="modal-title">Steam Guard (2FA) Required</h3>
          <button class="modal-close" @click="cancelSteamGuard" aria-label="Close">✕</button>
        </div>
        <div class="modal-body">
          <p class="guard-description">
            Enter the Steam Guard code sent to your email/mobile authenticator for account <strong>{{ steamGuardUser }}</strong>.
          </p>
          <div class="guard-input-wrap">
            <input 
              v-model="steamGuardCode" 
              placeholder="e.g. ABCDE" 
              maxlength="5" 
              class="steam-guard-input" 
              @keyup.enter="submitSteamGuard" 
              autofocus
            />
          </div>
          <p v-if="steamGuardError" class="guard-error">{{ steamGuardError }}</p>
        </div>
        <div class="modal-actions">
          <button @click="submitSteamGuard" class="btn-primary" :disabled="steamGuardCode.length < 5">Submit Code</button>
          <button @click="cancelSteamGuard" class="btn-secondary">Cancel</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import type { Game } from './classes'
import steamIcon from '../assets/Steam_icon_logo.svg'
import upgradeIcon from '../assets/icons8-upgrade-48.png'

const games = ref<Game[]>([])
const loading = ref(true)
const launchingSteamIDs = ref<Set<number>>(new Set())
const showNotesModal = ref(false)
const notesText = ref('')
const pendingLaunchIndex = ref<number | null>(null)
const modalGameName = ref('')
const draggingSteamID = ref<number | null>(null)
const dragOverSteamID = ref<number | null>(null)
const appVersion = ref('')

const showSteamGuardModal = ref(false)
const steamGuardCode = ref('')
const steamGuardUser = ref('')
const steamGuardSteamID = ref<number | null>(null)
const steamGuardError = ref('')

const updateProgress = ref<Record<number, {
  status: string
  progress: number
  bytesDownloaded?: number
  bytesTotal?: number
  error?: string
}>>({})

onMounted(() => {
  // Fetch app version
  window.electronAPI.getAppVersion().then(v => {
    appVersion.value = v
    document.title = `SteamLauncher v${v}`
  }).catch(e => {
    console.error('Failed to get app version:', e)
  })

  // Listen for games loaded from main process
  window.electronAPI.onGamesLoaded((loadedGames: Game[]) => {
    games.value = loadedGames
    loading.value = false
    const validIds = new Set(loadedGames.map(g => g.steamID))
    const filtered = new Set<number>()
    launchingSteamIDs.value.forEach(id => {
      if (validIds.has(id)) {
        filtered.add(id)
      }
    })
    launchingSteamIDs.value = filtered
  })
  // Launching state events
  window.electronAPI.onLaunchingStarted(payload => {
    const steamID = resolveSteamID(payload)
    if (typeof steamID === 'number') {
      const next = new Set(launchingSteamIDs.value)
      next.add(steamID)
      launchingSteamIDs.value = next
    }
  })
  window.electronAPI.onLaunchingStopped(payload => {
    const steamID = resolveSteamID(payload)
    if (typeof steamID === 'number') {
      const next = new Set(launchingSteamIDs.value)
      next.delete(steamID)
      launchingSteamIDs.value = next
    }
  })

  // Game update progress tracking
  window.electronAPI.onUpdateProgress((data) => {
    if (data.status === 'completed' || data.status === 'failed') {
      if (data.status === 'failed') {
        alert(`Update failed: ${data.error || 'Unknown error'}`)
      }
      delete updateProgress.value[data.steamID]
    } else {
      updateProgress.value[data.steamID] = {
        status: data.status,
        progress: data.progress,
        bytesDownloaded: data.bytesDownloaded,
        bytesTotal: data.bytesTotal,
        error: data.error
      }
    }
  })

  // Steam Guard (2FA) request listener
  window.electronAPI.onSteamGuardRequired((data) => {
    steamGuardSteamID.value = data.steamID
    steamGuardUser.value = data.user
    steamGuardCode.value = ''
    steamGuardError.value = ''
    showSteamGuardModal.value = true
  })
})

const resolveSteamID = (payload: unknown): number | undefined => {
  if (payload && typeof payload === 'object' && 'steamID' in payload) {
    const steamID = (payload as { steamID?: unknown }).steamID
    return typeof steamID === 'number' ? steamID : undefined
  }
  if (typeof payload === 'number') {
    return games.value[payload]?.steamID
  }
  return undefined
}

const persistOrder = async (orderedGames: Game[]) => {
  try {
    await window.electronAPI.saveGameOrder(orderedGames.map(g => g.steamID))
  } catch (error) {
    console.error('Failed to save game order:', error)
  }
}

const resetDragState = () => {
  draggingSteamID.value = null
  dragOverSteamID.value = null
}

const reorderGames = (beforeSteamID?: number) => {
  const sourceSteamID = draggingSteamID.value
  if (sourceSteamID === null) return
  const updated = [...games.value]
  const sourceIndex = updated.findIndex(g => g.steamID === sourceSteamID)
  if (sourceIndex === -1) {
    resetDragState()
    return
  }
  const [moved] = updated.splice(sourceIndex, 1)
  if (typeof beforeSteamID === 'number') {
    let targetIndex = updated.findIndex(g => g.steamID === beforeSteamID)
    if (targetIndex === -1) {
      updated.push(moved)
    } else {
      updated.splice(targetIndex, 0, moved)
    }
  } else {
    updated.push(moved)
  }
  games.value = updated
  persistOrder(updated)
  resetDragState()
}

const gameCardClasses = (index: number) => {
  const steamID = games.value[index]?.steamID
  return {
    'game-card': true,
    dragging: steamID != null && steamID === draggingSteamID.value,
    'drag-over': steamID != null && steamID === dragOverSteamID.value,
  }
}

const launchGame = async (index: number) => {
  const g = games.value[index]
  const notes = (g.notes || '').trim()
  if (notes.length > 0) {
    pendingLaunchIndex.value = index
    notesText.value = notes
    modalGameName.value = g.name
    showNotesModal.value = true
    // Start immediately in parallel; do not wait for user confirmation
    void doStart(index)
    return
  }
  await doStart(index)
}

const doStart = async (index: number) => {
  try {
    const result = await window.electronAPI.startGame(index)
    if (result.success) {
      console.log(`Launched ${games.value[index].name}`)
    } else {
      console.error(`Failed to launch ${games.value[index].name}:`, result.error)
      alert(`Failed to launch game: ${result.error}`)
    }
  } catch (error) {
    console.error('Launch error:', error)
    alert('Error launching game')
  }
}

const cancelLaunch = () => {
  // Launch already started; just close the notes modal
  showNotesModal.value = false
  pendingLaunchIndex.value = null
}

const openSettings = async () => {
  try {
    await window.electronAPI.openSettings()
    // For now, this will just log. We'll implement settings window later
  } catch (error) {
    console.error('Settings error:', error)
  }
}

const configureGame = async (index: number) => {
  await window.electronAPI.openConfigure(games.value[index].steamID)
}

const toggleHidden = async (index: number) => {
  try {
    await window.electronAPI.toggleHidden(games.value[index].steamID)
  } catch (error) {
    console.error('Toggle hidden error:', error)
  }
}

const startSteamOnly = async (index: number) => {
  try {
    const result = await window.electronAPI.startSteamOnly(index)
    if (!result.success) {
      alert(`Failed to start Steam: ${result.error}`)
    }
  } catch (e) {
    alert('Error starting Steam')
  }
}

const isLaunching = (index: number) => {
  const steamID = games.value[index]?.steamID
  return typeof steamID === 'number' ? launchingSteamIDs.value.has(steamID) : false
}

const triggerUpdate = async (steamID: number) => {
  try {
    const res = await window.electronAPI.updateGame(steamID)
    if (!res.success) {
      alert(`Update failed: ${res.error}`)
    }
  } catch (err) {
    alert(`Error: ${(err as Error).message}`)
  }
}

const submitSteamGuard = async () => {
  if (!steamGuardSteamID.value) return
  const code = steamGuardCode.value.trim().toUpperCase()
  if (code.length < 5) return

  try {
    const res = await window.electronAPI.submitSteamGuard(steamGuardSteamID.value, code)
    if (res.success) {
      showSteamGuardModal.value = false
      steamGuardSteamID.value = null
    } else {
      steamGuardError.value = res.error || 'Failed to submit code'
    }
  } catch (err) {
    steamGuardError.value = (err as Error).message
  }
}

const cancelSteamGuard = async () => {
  if (!steamGuardSteamID.value) return
  try {
    await window.electronAPI.cancelUpdate(steamGuardSteamID.value)
  } catch (e) {
    console.error('Failed to cancel update:', e)
  }
  showSteamGuardModal.value = false
  steamGuardSteamID.value = null
}

const cancelUpdate = async (steamID: number) => {
  try {
    await window.electronAPI.cancelUpdate(steamID)
    delete updateProgress.value[steamID]
  } catch (err) {
    console.error('Failed to cancel update:', err)
  }
}

const isUpdating = (steamID: number) => {
  return !!updateProgress.value[steamID]
}

const getUpdateStatusText = (steamID: number) => {
  const p = updateProgress.value[steamID]
  if (!p) return ''
  if (p.status === 'checking') return 'Checking...'
  if (p.status === '2fa') return 'Awaiting Steam Guard...'
  if (p.status === 'downloading') return 'Downloading...'
  if (p.status === 'validating') return 'Validating...'
  if (p.status === 'preallocating') return 'Preallocating...'
  return 'Updating...'
}

const getUpdateProgress = (steamID: number) => {
  const p = updateProgress.value[steamID]
  return p ? p.progress : 0
}

const onCardDragStart = (index: number, event: DragEvent) => {
  const game = games.value[index]
  if (!game) return
  draggingSteamID.value = game.steamID
  dragOverSteamID.value = null
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', game.steamID.toString())
  }
}

const onCardDragOver = (index: number, event: DragEvent) => {
  if (!draggingSteamID.value) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  const steamID = games.value[index]?.steamID
  if (!steamID || steamID === draggingSteamID.value) {
    dragOverSteamID.value = null
    return
  }
  dragOverSteamID.value = steamID
}

const onCardDragLeave = (index: number) => {
  const steamID = games.value[index]?.steamID
  if (steamID && steamID === dragOverSteamID.value) {
    dragOverSteamID.value = null
  }
}

const onCardDrop = (index: number, event: DragEvent) => {
  event.preventDefault()
  const steamID = games.value[index]?.steamID
  reorderGames(steamID)
}

const onCardDragEnd = () => {
  resetDragState()
}

const onGridDragOver = (event: DragEvent) => {
  if (!draggingSteamID.value) return
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
  dragOverSteamID.value = null
}

const onGridDrop = (event: DragEvent) => {
  event.preventDefault()
  reorderGames(undefined)
}

const refresh = async () => {
  loading.value = true
  try {
    await window.electronAPI.refreshGames()
    // games-loaded event will update list and stop loading
  } catch (e) {
    loading.value = false
  }
}
</script>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

.main {
  flex: 1;
  padding: 2rem;
}

.app {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

.header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  background-color: var(--surface-2);
  border-bottom: 1px solid var(--border-color);
  padding: 0.5rem 1.5rem;
}

.header-logo {
  display: flex;
  align-items: center;
  gap: 8px;
}

.logo-text {
  font-size: 1.15rem;
  font-weight: 700;
  color: var(--text-color);
  letter-spacing: 0.03em;
}

.version-tag {
  font-size: 0.75rem;
  background-color: var(--accent-weak);
  border: 1px solid var(--border-color);
  color: var(--accent-color);
  padding: 1px 6px;
  border-radius: 12px;
  font-family: monospace;
}

.header-actions { display: flex; align-items: center; }
.app-refresh-btn,
.app-settings-btn {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1rem;
  cursor: pointer;
  padding: 0.5rem;
  transition: background-color 0.2s;
  display: block;
}

.app-refresh-btn:hover,
.app-settings-btn:hover {
  background-color: var(--accent-weak);
}


.loading, .no-games {
  text-align: center;
  padding: 3rem;
  font-size: 1.5rem;
}

.game-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, 320px);
  gap: 1.5rem;
  margin: 0 auto;
}

.game-card {
  background-color: var(--surface-1);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.2);
  border: 1px solid var(--border-color);
  transition: transform 0.2s, box-shadow 0.2s;
  cursor: pointer;
  position: relative;
}

.game-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.3);
}

.game-info {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem;
}

.game-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.game-actions button {
  background: none;
  border: none;
  padding: 0;
  margin: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: var(--text-color);
  font-size: 1.05rem;
  line-height: 1;
  transition: background-color 0.2s, filter 0.2s;
  border-radius: 4px;
}

.game-actions button:hover {
  filter: brightness(1.2);
  background-color: var(--hover-color, rgba(61, 174, 233, 0.15));
}

.game-actions button img {
  width: 1.05rem;
  height: 1.05rem;
  display: block;
  object-fit: contain;
}

.game-icon {
  width: 320px;
  object-fit: contain;
  display: block;
  background-color: var(--surface-1);
}

.launching-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0,0,0,0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  pointer-events: none;
}
.spinner {
  width: 18px; height: 18px;
  border: 3px solid rgba(255,255,255,0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}
.launching-text { color: #fff; font-size: 0.95rem; }
@keyframes spin { to { transform: rotate(360deg); } }

.modal-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}
.modal {
  background: var(--surface-1);
  color: var(--text-color);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  width: min(720px, 90vw);
  max-height: 80vh;
  padding: 16px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.modal-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.modal-title { font-size: 1.1rem; font-weight: 600; }
.modal-close { background: none; border: none; color: var(--text-color); font-size: 1.2rem; line-height: 1; cursor: pointer; padding: 4px 6px; border-radius: 4px; }
.modal-close:hover { background: var(--accent-weak); }
.notes-content {
  white-space: pre-wrap;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 10px;
  overflow: auto;
  max-height: 50vh;
}

/* Game Update Overlay & Progress Styles */
.updating-overlay {
  position: absolute;
  inset: 0;
  background: rgba(10, 15, 30, 0.9);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  padding: 1.5rem;
  z-index: 10;
  backdrop-filter: blur(4px);
  cursor: default;
}

.updating-info {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
}

.updating-status {
  font-size: 0.9rem;
  font-weight: 600;
  color: var(--accent-color);
  text-transform: capitalize;
  letter-spacing: 0.05em;
}

.progress-bar-track {
  width: 100%;
  height: 8px;
  background: rgba(255, 255, 255, 0.1);
  border-radius: 4px;
  overflow: hidden;
  border: 1px solid rgba(61, 174, 233, 0.2);
}

.progress-bar-fill {
  height: 100%;
  background: linear-gradient(90deg, #1b75bc, var(--accent-color));
  border-radius: 4px;
  box-shadow: 0 0 8px rgba(61, 174, 233, 0.6);
  transition: width 0.3s ease;
}

.updating-percentage {
  font-size: 0.85rem;
  color: var(--text-color);
}

.update-cancel-btn {
  position: absolute;
  top: 10px;
  right: 10px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.1);
  color: var(--muted-text);
  border-radius: 50%;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 0.8rem;
  padding: 0;
  cursor: pointer;
  transition: all 0.2s ease;
}

.update-cancel-btn:hover {
  background: var(--danger) !important;
  color: #fff !important;
  border-color: var(--danger) !important;
  transform: scale(1.1);
}

/* Steam Guard Modal Styles */
.steam-guard-modal {
  max-width: 400px !important;
}

.guard-description {
  font-size: 0.95rem;
  line-height: 1.4;
  margin-bottom: 1rem;
}

.guard-input-wrap {
  display: flex;
  justify-content: center;
  margin: 1.5rem 0;
}

.steam-guard-input {
  width: 150px !important;
  font-size: 1.8rem !important;
  text-align: center;
  letter-spacing: 0.2em;
  text-transform: uppercase;
  font-weight: 700;
  padding: 8px !important;
  border: 2px solid var(--border-color) !important;
  border-radius: 8px !important;
  background: var(--surface-2) !important;
  color: var(--accent-color) !important;
}

.steam-guard-input:focus {
  border-color: var(--accent-color) !important;
  box-shadow: 0 0 10px rgba(61, 174, 233, 0.4);
}

.guard-error {
  color: var(--danger);
  font-size: 0.85rem;
  text-align: center;
  margin-top: 0.5rem;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 0.5rem;
}

.btn-primary {
  background: var(--accent-color);
  color: #161925;
  font-weight: 600;
  border: none;
}

.btn-primary:hover {
  background: #50beff;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid var(--border-color);
}

</style>
