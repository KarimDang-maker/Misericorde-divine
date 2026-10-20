import axios, { type AxiosError } from "axios"

export type ApiError = {
  status?: number
  code: string
  message: string
  fields: Record<string, string>
  requestId?: string
  data?: unknown
}

export type ApiEnvelope<T> = { success: true; data: T; meta?: Record<string, unknown> }

export const httpClient = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL || "/api",
  withCredentials: true,
  timeout: 15_000,
  headers: { Accept: "application/json", "Content-Type": "application/json" },
})

httpClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<{ error?: Partial<ApiError>; data?: unknown }>) => {
    let responseBody = error.response?.data as { error?: Partial<ApiError>; data?: unknown } | undefined
    if (typeof Blob !== "undefined" && responseBody instanceof Blob) {
      try { responseBody = JSON.parse(await responseBody.text()) as { error?: Partial<ApiError>; data?: unknown } } catch { responseBody = undefined }
    }
    const apiError: ApiError = {
      status: error.response?.status,
      code: responseBody?.error?.code ?? (error.code === "ECONNABORTED" ? "TIMEOUT" : "NETWORK_ERROR"),
      message: responseBody?.error?.message ?? (error.code === "ECONNABORTED" ? "Le serveur met trop de temps à répondre." : "Impossible de communiquer avec le serveur."),
      fields: responseBody?.error?.fields ?? {},
      requestId: responseBody?.error?.requestId,
      data: responseBody?.data,
    }
    return Promise.reject(apiError)
  },
)

export async function apiGet<T>(path: string, params?: Record<string, unknown>) {
  const { data } = await httpClient.get<ApiEnvelope<T>>(path, { params })
  return data
}
export async function apiPost<T>(path: string, payload?: unknown) {
  const { data } = await httpClient.post<ApiEnvelope<T>>(path, payload)
  return data
}
export async function apiPut<T>(path: string, payload?: unknown) {
  const { data } = await httpClient.put<ApiEnvelope<T>>(path, payload)
  return data
}
export async function apiPatch<T>(path: string, payload?: unknown) {
  const { data } = await httpClient.patch<ApiEnvelope<T>>(path, payload)
  return data
}
export async function apiDelete(path: string) { await httpClient.delete(path) }
export async function apiUpload<T>(path: string, payload: FormData) {
  const { data } = await httpClient.post<ApiEnvelope<T>>(path, payload, { headers: { "Content-Type": "multipart/form-data" } })
  return data
}
export async function apiDownload(path: string, filename: string) {
  const { data } = await httpClient.get<Blob>(path, { responseType: "blob" })
  const url = URL.createObjectURL(data)
  const link = document.createElement("a")
  link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}
