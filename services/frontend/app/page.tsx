import { redirect } from "next/navigation"
import { cookies } from "next/headers"

export default async function Page() {
  const cookieStore = await cookies()
  const token = cookieStore.get("krypt_session")?.value

  if (!token) {
    redirect("/auth/login")
  }

  redirect("/diary")
}
