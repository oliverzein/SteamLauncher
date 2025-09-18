<template>
  <div class="wrap">
    <h2>Settings</h2>

    <div class="section">
      <div class="section-header">
        <h3 class="section-title">Compatdata paths</h3>
        <button class="btn-compact" title="Add path" @click="addPath">+</button>
      </div>
      <p class="muted small">One path per line:</p>
      <div v-for="(p,i) in compatdataPaths" :key="i" class="row path-row">
        <input v-model="compatdataPaths[i]" placeholder="/home/user/.local/share/Steam/steamapps/compatdata" />
        <button class="btn-compact" title="Remove this path" @click="removePath(i)">-</button>
      </div>
    </div>

    <hr class="divider" />

    <div class="section">
      <h3 class="section-title">Behavior</h3>
      <div class="row">
        <label class="checkbox">
          <input type="checkbox" v-model="startMinimized" />
          <span>Start minimized to tray</span>
        </label>
        <p class="hint muted">When enabled, the app will hide to the tray on startup.</p>
      </div>
    </div>

    <div class="actions top-gap">
      <button @click="save">Save Settings</button>
    </div>

    <hr class="divider large" />

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
const startMinimized = ref<boolean>(false)

const loadConfig = async () => {
  const cfg = await window.electronAPI.getConfig()
  compatdataPaths.value = Array.isArray(cfg.compatdataPaths) ? [...cfg.compatdataPaths] : []
  startMinimized.value = !!cfg.startMinimized
}

const addPath = () => {
  compatdataPaths.value.push('')
}

const removePath = (i: number) => {
  if (i >= 0 && i < compatdataPaths.value.length) {
    compatdataPaths.value.splice(i, 1)
  }
}

const save = async () => {
  await window.electronAPI.saveConfig({
    compatdataPaths: compatdataPaths.value.filter(p => p && p.length > 0),
    startMinimized: startMinimized.value,
  })
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
  color: var(--text-color);
  background: var(--bg-color);
  min-height: 100vh;
}
.row { margin-bottom: 8px; }
.section-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.path-row { display: flex; align-items: center; gap: 8px; }
.path-row input { flex: 1; }
.btn-compact {
  padding: 0 8px;
  height: 26px;
  min-width: 26px;
  border-radius: 6px;
  background: var(--surface-2);
  border: 1px solid var(--border-color);
  color: var(--text-color);
  line-height: 1;
}
.small { font-size: 0.9rem; }
.section { padding: 8px 0; }
.section-title { margin: 0 0 8px; font-weight: 600; }
.top-gap { margin-top: 8px; }
.checkbox { display: flex; align-items: center; gap: 8px; user-select: none; }
.checkbox input[type="checkbox"] { width: auto; height: 16px; }
.checkbox span { line-height: 1.2; }
.hint { margin-top: 4px; }
input:not([type='checkbox']) {
  width: 100%;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: var(--surface-2);
  color: var(--text-color);
}
.actions { display: flex; gap: 8px; }
button { padding: 6px 10px; }
.divider { margin: 12px 0; border: none; height: 1px; background: var(--border-color); }
.divider.large { margin: 20px 0; }
.muted { color: var(--muted-text); }
.hidden-list { list-style: none; padding: 0; margin: 8px 0 0; }
.hidden-item { display: flex; justify-content: space-between; align-items: center; padding: 8px; border: 1px solid var(--border-color); border-radius: 6px; margin-bottom: 8px; background: var(--surface-1); }
.title { font-weight: 600; }
.unhide { padding: 4px 8px; }
</style>
