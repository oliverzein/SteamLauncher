<template>
  <div class="wrap">
    <h2>Configure Game</h2>

    <div class="row">
      <label>Username</label>
      <input v-model="user" />
    </div>

    <div class="row">
      <label>Password</label>
      <input type="password" v-model="password" placeholder="Leave blank to keep existing" />
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
const user = ref('')
const password = ref('')

const onConfigureGame = (game: { user: string; name: string }, i: number) => {
  user.value = game.user
  password.value = ''
  index.value = i
  document.title = `${game.name} - Configure`
}

onMounted(() => {
  window.electronAPI.onConfigureGame(onConfigureGame)
})

const save = async () => {
  if (index.value >= 0) {
    await window.electronAPI.saveGameConfig(index.value, user.value, password.value)
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
.actions { display: flex; gap: 8px; }
button { padding: 6px 10px; }
</style>
