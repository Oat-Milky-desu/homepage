<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <main class="page not-found">
    <div class="card-surface not-found-card">
      <h1>页面不存在</h1>
      <p class="muted">你访问的地址没有对应的页面。</p>
      <button type="button" class="btn btn-primary" @click="router.replace('/')">返回首页</button>
    </div>
  </main>
</template>

<style scoped>
.not-found {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 70vh;
}

.not-found-card {
  text-align: center;
  padding: 40px;
}

.not-found-card h1 {
  margin: 0 0 8px;
  font-size: 1.3rem;
}
</style>
