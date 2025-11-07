<template>
  <div class="wrap">

    <div class="row">
      <label>Username</label>
      <input v-model="user" :class="{ invalid: usernameError }" @input="usernameError = ''" />
      <p v-if="usernameError" class="error">{{ usernameError }}</p>
    </div>

    <div class="row">
      <label>Password</label>
      <div class="password-row">
        <input :type="showPassword ? 'text' : 'password'" v-model="password" placeholder="Leave blank to keep existing" />
        <button type="button" class="toggle" @click="showPassword = !showPassword">{{ showPassword ? 'Hide' : 'Show' }}</button>
        <button type="button" class="toggle" @click="fillFromKeychain">Fill from keychain</button>
      </div>
      <p v-if="passwordError" class="error">{{ passwordError }}</p>
    </div>

    <div class="row">
      <label>Process name (optional)</label>
      <input v-model="processName" placeholder="e.g., Palworld-Win64-Shipping" />
      <p class="hint">Used for the busy indicator. We stop showing "Launching…" once this process appears.</p>
    </div>

    <div class="row">
      <label>Screen resolution (optional)</label>
      <input v-model="resolution" placeholder="e.g., output.HDMI-A-1.mode.3840x2160@60" />
      <p class="hint">If set, we run <code>kscreen-doctor</code> with this string before launch.</p>
    </div>

    <div class="row">
      <label>Notes</label>
      <textarea v-model="notes" rows="8" placeholder="Write notes for this game..."></textarea>
      <p class="hint">Notes are stored locally in the app config.</p>
    </div>

    <div class="actions">
      <button @click="save">Save</button>
      <button @click="closeWin">Close</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'

const index = ref<number>(-1)
const steamID = ref<number>(0)
const user = ref('')
const password = ref('')
const showPassword = ref(false)
const usernameError = ref('')
const passwordError = ref('')
const processName = ref('')
const resolution = ref('')
const notes = ref('')

const onConfigureGame = (game: { user: string; name: string; steamID: number; processName?: string; resolution?: string; notes?: string }, i: number) => {
  user.value = game.user
  password.value = ''
  index.value = i
  steamID.value = game.steamID
  processName.value = game.processName || ''
  resolution.value = game.resolution || ''
  notes.value = game.notes || ''
  document.title = `${game.name} - Configure`
}

const fillFromKeychain = async () => {
  passwordError.value = ''
  if (index.value < 0 || !steamID.value) return
  try {
    const result = await window.electronAPI.getStoredPassword(steamID.value, user.value)
    if (result.success && result.password) {
      password.value = result.password
      showPassword.value = true
    } else {
      passwordError.value = result.error || 'No password stored for this game/user.'
    }
  } catch (e) {
    passwordError.value = 'Failed to retrieve password.'
  }
}

onMounted(() => {
  window.electronAPI.onConfigureGame(onConfigureGame)
})

const save = async () => {
  if (!user.value || user.value.trim().length === 0) {
    usernameError.value = 'Username is required.'
    return
  }
  if (index.value >= 0) {
    await window.electronAPI.saveGameConfig(index.value, user.value, password.value, processName.value, resolution.value, notes.value)
    window.close()
  }
}

const closeWin = () => window.close()
</script>

<style scoped>
.wrap {
  padding: 16px;
  color: var(--text-color);
  background: var(--bg-color);
  min-height: 100vh;
}
.row { margin-bottom: 10px; }
label { display:block; margin-bottom: 4px; }
input {
  width: 100%;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: var(--surface-2);
  color: var(--text-color);
}
textarea {
  width: 100%;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid var(--border-color);
  background: var(--surface-2);
  color: var(--text-color);
  resize: vertical;
}
.password-row { display: flex; gap: 8px; }
.password-row input { flex: 1; }
.toggle { padding: 6px 10px; }
.error { color: var(--danger); margin: 4px 0 0; font-size: 0.9em; }
.invalid { border-color: var(--danger); }
.hint { color: var(--muted-text); margin: 4px 0 0; font-size: 0.85em; }
.actions { display: flex; gap: 8px; }
button { padding: 6px 10px; }
</style>
