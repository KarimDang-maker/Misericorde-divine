import { createBrowserRouter } from "react-router"
import { AppShell } from "@/components/layout/AppShell"
import { ResourcePage } from "@/pages/shared/ResourcePage"
import { NotFoundPage } from "@/pages/shared/NotFoundPage"
import { navigationItems } from "@/config/navigation"
import { LoginPage } from "@/pages/auth/LoginPage"
import { CategoryPage } from "@/pages/categories/CategoryPage"

const moduleRoutes = navigationItems
  .flatMap((group) => group.items)
  .filter((item) => item.path !== "/")
  .map((item) => ({
    path: item.path.slice(1),
    element: item.path === "/rubriques" ? <CategoryPage /> : (
      <ResourcePage
        title={item.label}
        description={item.description}
        apiDependency={item.apiDependency}
      />
    ),
  }))

export const router = createBrowserRouter([
  { path: "/connexion", Component: LoginPage },
  {
    path: "/",
    Component: AppShell,
    children: [
      {
        index: true,
        lazy: async () => {
          const { DashboardPage } = await import(
            "@/pages/dashboard/DashboardPage"
          )
          return { Component: DashboardPage }
        },
      },
      ...moduleRoutes,
      { path: "*", Component: NotFoundPage },
    ],
  },
])
