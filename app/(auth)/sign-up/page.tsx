'use client';

import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import InputField from "@/components/forms/InputField";
import PasswordRequirements from "@/components/forms/PasswordRequirements";
import { PASSWORD_VALIDATION } from "@/lib/constants";
import { CountrySelectField } from "@/components/forms/CountrySelectField";
import FooterLink from "@/components/forms/FooterLink";
import { signUpWithEmail } from "@/lib/actions/auth.actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import SocialAuthButtons from "@/components/forms/SocialAuthButtons";
import React from "react";

const SignUp = () => {
    const router = useRouter()
    const {
        register,
        handleSubmit,
        control,
        watch,
        formState: { errors, isSubmitting },
    } = useForm<SignUpFormData>({
        defaultValues: {
            fullName: '',
            email: '',
            password: '',
            country: 'CA',
        },
        mode: 'onBlur'
    },);

    const passwordValue = watch('password');

    const onSubmit = async (data: SignUpFormData) => {
        try {
            const result = await signUpWithEmail(data);
            if (result.success && result.verify) {
                toast.success('Check your email', { description: 'Tap the link we sent to confirm your address, then sign in.' });
                router.push('/sign-in');
                return;
            }
            if (result.success) {
                router.push('/dashboard');
                return;
            }
            toast.error('Sign up failed', {
                description: result.error ?? 'We could not create your account.',
            });
        } catch (e) {
            console.error(e);
            toast.error('Sign up failed', {
                description: e instanceof Error ? e.message : 'Failed to create an account.'
            })
        }
    }

    return (
        <>
            <h1 className="form-title mb-2">Create your account</h1>
            <p className="mb-8 text-faint">Free and open source. No card needed.</p>

            <SocialAuthButtons />

            <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-8">
                <section className="flex flex-col gap-4" aria-label="Account">
                    <InputField
                        name="fullName"
                        label="Full name"
                        placeholder="Your name"
                        register={register}
                        error={errors.fullName}
                        validation={{ required: 'Full name is required', minLength: 2 }}
                    />
                    <InputField
                        name="email"
                        label="Email"
                        placeholder="you@example.com"
                        register={register}
                        error={errors.email}
                        validation={{
                            required: 'Email is required',
                            pattern: {
                                value: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/,
                                message: 'Please enter a valid email address'
                            }
                        }}
                    />
                    <div className="flex flex-col gap-2">
                        <InputField
                            name="password"
                            label="Password"
                            placeholder="At least 8 characters"
                            type="password"
                            register={register}
                            error={errors.password}
                            validation={PASSWORD_VALIDATION}
                        />
                        <PasswordRequirements password={passwordValue ?? ''} />
                    </div>
                </section>

                <section className="flex flex-col gap-5 border-t border-line pt-6" aria-labelledby="personalize">
                    <div>
                        <p id="personalize" className="kicker text-brand-ink">Personalize</p>
                        <p className="mt-1 text-[13px] text-faint">Sets which market opens first. TSX stocks work too: add them as SHOP.TO.</p>
                    </div>
                    <CountrySelectField
                        name="country"
                        label="Country"
                        control={control}
                        error={errors.country}
                        required
                    />
                </section>

                <div className="flex flex-col gap-4">
                    <Button type="submit" disabled={isSubmitting} className="yellow-btn w-full">
                        {isSubmitting ? 'Creating account' : 'Create account'}
                    </Button>
                    <FooterLink text="Already have an account?" linkText="Sign in" href="/sign-in" />
                </div>
            </form>
            <p className="mt-6 text-[12px] text-faint">Apex Tradebook is an educational research tool. Nothing here is investment advice, and it is not a registered dealer or adviser.</p>
        </>
    )
}
export default SignUp;
