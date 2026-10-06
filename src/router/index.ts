import { createRouter, createWebHashHistory } from "vue-router";
import ConfiguratorPage from "../pages/ConfiguratorPage.vue";
import SharePage from "../pages/SharePage.vue";
import RevisionsPage from "../pages/RevisionsPage.vue";

export const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "configurator", component: ConfiguratorPage },
    { path: "/revisions", name: "revisions", component: RevisionsPage },
    { path: "/share/:payload", name: "share", component: SharePage },
  ],
});
