<template>
  <div id="app" class="app">
    <header class="header">
      <h1>Steam Game Launcher</h1>
      <button @click="openSettings" class="app-settings-btn">⚙️</button>
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
              <button @click="toggleHidden(index)" :title="game.hidden ? 'Unhide game' : 'Hide game'" class="game-hide-icon">{{ game.hidden ? '👁️‍🗨️' : '👁️' }}</button>
              <button @click="configureGame(index)" class="game-settings-icon">⚙️</button>
            </div>
          </div>
        </div>
      </div>
    </main>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { Game } from './classes'

const games = ref<Game[]>([])
const loading = ref(true)

onMounted(() => {
  // Listen for games loaded from main process
  window.electronAPI.onGamesLoaded((loadedGames: Game[]) => {
    games.value = loadedGames
    loading.value = false
    console.log(games.value)
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
</script>

<style>
/* Dark theme variables */
:root {
  --bg-color: #1a1a1a;
  --card-bg: #2a2a2a;
  --text-color: #ffffff;
  --accent-color: #444444;
  --hover-color: #555555;
  --border-color: #333333;
}

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-color);
  overflow-x: hidden;
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
  background-color: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.header h1 {
  font-size: 1.5rem;
  font-weight: 600;
}

.app-settings-btn {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background-color 0.2s;
  display: block;
}

.app-settings-btn:hover {
  background-color: var(--accent-color);
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
  background-color: var(--card-bg);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
  transition: transform 0.2s, box-shadow 0.2s;
  cursor: pointer;
}

.game-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
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

.game-hide-icon:hover {
  transform: scale(1.5);
}

.game-icon {
  width: 320px;
  object-fit: contain;
  display: block;
  background-color: var(--card-bg);
}

.game-settings-icon {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1.0rem;
  cursor: pointer;
  border-radius: 4px;
  transition: background-color 0.2s;
  display: block;
}

.game-settings-icon:hover {
  transform: scale(1.5);
}

</style>
