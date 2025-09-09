<template>
  <div id="app" class="app">
    <header class="header">
      <h1>Steam Game Launcher</h1>
      <button @click="openSettings" class="settings-btn">⚙️</button>
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
          @click="launchGame(index)"
        >
          <img 
            v-if="game.icon" 
            :src="game.icon" 
            :alt="game.name" 
            class="game-icon"
          />
          <div class="game-info">
            <h3 class="game-title">{{ game.name }}</h3>
            <button class="launch-btn" @click.stop="launchGame(index)">
              Launch
            </button>
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

.settings-btn {
  background: none;
  border: none;
  color: var(--text-color);
  font-size: 1.5rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
  transition: background-color 0.2s;
}

.settings-btn:hover {
  background-color: var(--accent-color);
}

.main {
  flex: 1;
  padding: 2rem;
}

.loading, .no-games {
  text-align: center;
  padding: 3rem;
  font-size: 1.2rem;
}

.game-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 1.5rem;
  max-width: 1200px;
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

.game-icon {
  width: 100%;
  height: 150px;
  object-fit: contain;
  display: block;
  background-color: var(--card-bg);
}

.game-info {
  padding: 1rem;
}

.game-title {
  font-size: 1rem;
  font-weight: 600;
  margin-bottom: 0.75rem;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  line-clamp: 2;
  overflow: hidden;
}

.launch-btn {
  width: 100%;
  padding: 0.75rem;
  background-color: var(--accent-color);
  color: var(--text-color);
  border: none;
  border-radius: 4px;
  font-size: 0.9rem;
  font-weight: 500;
  cursor: pointer;
  transition: background-color 0.2s;
}

.launch-btn:hover {
  background-color: var(--hover-color);
}

@media (max-width: 768px) {
  .game-grid {
    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 1rem;
  }
  
  .header {
    padding: 1rem;
  }
  
  .main {
    padding: 1rem;
  }
}
</style>
