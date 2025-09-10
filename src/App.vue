<template>
  <div id="app" class="app">
    <header class="header">
      <h1>Steam Game Launcher</h1>
      <div class="header-actions">
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
      
      <div v-else class="game-grid">
        <div 
          v-for="(game, index) in games" 
          :key="game.steamID"
          class="game-card"
        >
          <img 
            v-if="game.icon" 
            :src="game.icon" 
            :alt="game.name" 
            class="game-icon"
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
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Game } from './classes'
import steamIcon from '../assets/Steam_icon_logo.svg'

const games = ref<Game[]>([])
const loading = ref(true)
const launching = ref<Set<number>>(new Set())

onMounted(() => {
  // Listen for games loaded from main process
  window.electronAPI.onGamesLoaded((loadedGames: Game[]) => {
    games.value = loadedGames
    loading.value = false
  })
  // Launching state events
  window.electronAPI.onLaunchingStarted((i: number) => {
    const next = new Set(launching.value)
    next.add(i)
    launching.value = next
  })
  window.electronAPI.onLaunchingStopped((i: number) => {
    const next = new Set(launching.value)
    next.delete(i)
    launching.value = next
  })
})

const launchGame = async (index: number) => {
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

const isLaunching = (index: number) => launching.value.has(index)
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
  padding: 1rem 2rem;
  background-color: var(--surface-2);
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.25);
}

.header h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.header-actions { display: flex; gap: 0.5rem; align-items: center; }
.app-settings-btn {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background-color 0.2s;
  display: block;
}

.app-settings-btn:hover {
  background-color: var(--accent-weak);
}


.loading, .no-games {
  text-align: center;
  padding: 3rem;
  font-size: 1.2rem;
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

</style>
