<template>
  <div class="wrap">
    <h2>Configure Game</h2>

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

const onConfigureGame = (game: { user: string; name: string; steamID: number; processName?: string }, i: number) => {
  user.value = game.user
  password.value = ''
  index.value = i
  steamID.value = game.steamID
  processName.value = game.processName || ''
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
    await window.electronAPI.saveGameConfig(index.value, user.value, password.value, processName.value)
    window.close()
  }
}

const closeWin = () => window.close()
</script>

<style scoped>
.wrap {
  padding: 16px;
  font-family: system-ui, -apple-system, Segoe UI, Roboto, Ubuntu, Cantarell, Noto Sans, Helvetica Neue, Arial, "Apple Color Emoji", "Segoe UI Emoji";
  color: #eee;
  background: #222;
  min-height: 100vh;
}
.row { margin-bottom: 10px; }
label { display:block; margin-bottom: 4px; }
input {
  width: 100%;
  padding: 6px;
  border-radius: 4px;
  border: 1px solid #555;
  background: #111;
  color: #eee;
}
.password-row { display: flex; gap: 8px; }
.password-row input { flex: 1; }
.toggle { padding: 6px 10px; }
.error { color: #ffb3b3; margin: 4px 0 0; font-size: 0.9em; }
.invalid { border-color: #cc6666; }
.hint { color: #bbb; margin: 4px 0 0; font-size: 0.85em; }
.actions { display: flex; gap: 8px; }
button { padding: 6px 10px; }
</style>
