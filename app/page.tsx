import { redirect } from "next/navigation";

// No public landing page: the middleware sends signed-out visitors to /sign-in
export default function Home() {
    redirect('/dashboard');
}
