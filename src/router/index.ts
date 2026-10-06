import { createRouter, createWebHashHistory } from "vue-router";
import ConfiguratorPage from "../pages/ConfiguratorPage.vue";
import SharePage from "../pages/SharePage.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "configurator", component: ConfiguratorPage },
    { path: "/share/:payload", name: "share", component: SharePage },
  ],
});
