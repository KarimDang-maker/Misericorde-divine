import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react"
import { apiGet, apiPost, type ApiError } from "@/api/httpClient"

export type User = { id: number; email: string; nom: string }
type AuthContextValue = { user: User | null; loading: boolean; error: ApiError | null; login: (email: string, motDePasse: string) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void> }
const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<ApiError | null>(null)
  const refresh = useCallback(async () => {
    try { const result = await apiGet<{ user: User }>("/auth/me"); setUser(result.data.user); setError(null) }
    catch (cause) { const apiError = cause as ApiError; setUser(null); if (apiError.status !== 401) setError(apiError) }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { void refresh() }, [refresh])
  const login = async (email: string, motDePasse: string) => {
    setError(null)
    try { const result = await apiPost<{ user: User; expiresAt: string }>("/auth/login", { email, motDePasse }); setUser(result.data.user) }
    catch (cause) { const apiError = cause as ApiError; setError(apiError); throw apiError }
  }
  const logout = async () => { try { await apiPost("/auth/logout") } catch { /* la session locale est terminée même si l'API est inaccessible */ } finally { setUser(null) } }
  return <AuthContext.Provider value={{ user, loading, error, login, logout, refresh }}>{children}</AuthContext.Provider>
}
export function useAuth() { const value = useContext(AuthContext); if (!value) throw new Error("useAuth doit être utilisé dans AuthProvider"); return value }
