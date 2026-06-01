<template>
  <div id="app" class="app">
    <header class="header">
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
          <div v-if="game.updateAvailable" class="update-badge" title="Update available">
            <img :src="upgradeIcon" alt="Update available" class="upgrade-icon-img" />
          </div>
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

onMounted(() => {
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
  justify-content: flex-end;
  align-items: center;
  background-color: var(--surface-2);
  border-bottom: 1px solid var(--border-color);
}

.header h1 {
  font-size: 1.5rem;
  font-weight: 600;
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
  gap: 0.5rem;
}

.game-icon {
  width: 320px;
  object-fit: contain;
  display: block;
  background-color: var(--surface-1);
}

.game-hide-icon {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1.0rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s;
  display: block;
}
.game-hide-icon:hover { filter: brightness(1.2); }

.game-settings-icon {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1.0rem;
  cursor: pointer;
}
.game-settings-icon:hover { filter: brightness(1.2); }

.start-steam-icon {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1rem;
  cursor: pointer;
}
.start-steam-icon img { width: 1.1rem; height: 1.1rem; display: block; }
.start-steam-icon:hover { filter: brightness(1.2); }

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

.update-badge {
  position: absolute;
  top: 10px;
  right: 10px;
  pointer-events: none;
  z-index: 5;
  filter: drop-shadow(0 2px 4px rgba(0, 0, 0, 0.5));
}

.upgrade-icon-img {
  width: 32px;
  height: 32px;
  display: block;
}

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

</style>
