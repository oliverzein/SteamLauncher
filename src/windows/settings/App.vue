<template>
  <div class="wrap">
    <h2>Settings</h2>
    <p>Compatdata paths (one per line):</p>
    <div v-for="(p,i) in compatdataPaths" :key="i" class="row">
      <input v-model="compatdataPaths[i]" placeholder="/home/user/.local/share/Steam/steamapps/compatdata" />
    </div>
    <div class="actions">
      <button @click="addPath">Add Path</button>
      <button @click="save">Save</button>
    </div>

    <hr class="divider" />

    <h3>Hidden games</h3>
    <p v-if="hiddenGames.length === 0" class="muted">No hidden games.</p>
    <ul v-else class="hidden-list">
      <li v-for="g in hiddenGames" :key="g.steamID" class="hidden-item">
        <span class="title">{{ g.name }}</span>
        <button class="unhide" @click="unhide(g.steamID)">Unhide</button>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import type { Game } from '../../classes'

const compatdataPaths = ref<string[]>([])
const allGames = ref<Game[]>([])

const loadConfig = async () => {
  const cfg = await window.electronAPI.getConfig()
  compatdataPaths.value = Array.isArray(cfg.compatdataPaths) ? [...cfg.compatdataPaths] : []
}

const addPath = () => {
  compatdataPaths.value.push('')
}

const save = async () => {
  await window.electronAPI.saveConfig({ compatdataPaths: compatdataPaths.value.filter(p => p && p.length > 0) })
  window.close()
}

const loadGames = async () => {
  allGames.value = await window.electronAPI.getAllGames()
}

const onConfigUpdated = () => {
  loadConfig()
  loadGames()
}

onMounted(() => {
  loadConfig()
  loadGames()
  window.electronAPI.onConfigUpdated(onConfigUpdated)
})

onBeforeUnmount(() => {
  // No explicit unsubscribe API; renderer will be destroyed with the window
})

const hiddenGames = computed(() => allGames.value.filter(g => g.hidden))

const unhide = async (steamID: number) => {
  await window.electronAPI.toggleHidden(steamID)
}
</script>

<style scoped>
.wrap {
  padding: 16px;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  color: #eee;
  background: #222;
  min-height: 100vh;
}
.row { margin-bottom: 8px; }
input {
  width: 100%;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid #555;
  background: #111;
  color: #eee;
}
.actions { display: flex; gap: 8px; }
button { padding: 6px 10px; }
.divider { margin: 16px 0; border: none; height: 1px; background: #444; }
.muted { color: #bbb; }
.hidden-list { list-style: none; padding: 0; margin: 8px 0 0; }
.hidden-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; border: 1px solid #444; border-radius: 6px; margin-bottom: 8px; background: #1a1a1a; }
.title { font-weight: 600; }
.unhide { padding: 4px 8px; }
</style>
