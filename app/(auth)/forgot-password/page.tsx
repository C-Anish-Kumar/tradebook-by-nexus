import { redirect } from "next/navigation";

// Email and password sign-in is gone; Google on /sign-in does sign-in and sign-up
export default function Page() {
    redirect("/sign-in");
}
