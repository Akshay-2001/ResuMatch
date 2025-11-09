import React, { useMemo, useRef, useState } from "react";
import axios from "axios";

/**
 * Resume Dashboard — React + Tailwind + FastAPI (your flow)
 *
 * 1) Submit (POST /resumes/) — send all data
 * 2) Preview Master Resume (GET /resumes/lookup/full?email=...) — receive _id + render
 * 3) Generate Tailored Resume (POST /resumes/:_id/rank-items) — send JD, render response
 */

/* ----------------------------- API ------------------------------ */
// FIX: Removed 'import.meta' to avoid build warnings. Hardcoding for this environment.
const API_BASE = "http://localhost:8000";
const api = axios.create({ baseURL: API_BASE });

// Add interceptor to include auth token in all requests
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("auth_token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/* ----------------- Frontend Form Types ----------------- */
type PersonalDetails = {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
};

type EducationItem = {
  institution: string;
  degree: string;
  start: string; // "Dec. 2026"
  end: string;   // "Dec. 2026" or "Present"
  details?: string; // optional
};

type ExperienceItem = {
  company: string;
  role: string;
  start: string;
  end: string;
  description: string; // REQUIRED
  achievements?: string;
};

type ProjectItem = {
  title: string;
  description?: string;
};

type SkillItem = {
  skill_name: string;
  category: string;
};

// This is the shape of the data in the React forms
type MasterResumeInput = {
  personal: PersonalDetails;
  education: EducationItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
  skills: SkillItem[];
};

/* ----------------- Backend API Types ----------------- */
// These types match your FastAPI backend models

type BE_Education = {
  education_id: string;
  institution_name: string;
  degree: string;
  field_of_study?: string | null;
  graduation_date?: string | null;
  start_date?: string | null;
};

type BE_WorkExperience = {
  work_ex_id: string;
  job_title: string;
  company_name: string;
  location?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  description_bullets?: string[] | null;
};

type BE_Project = {
  project_id: string;
  project_name: string;
  repository_url?: string | null;
  description_bullets?: string[] | null;
};

type BE_Skill = {
  skill_id: string;
  skill_name: string;
  category?: string | null;
};

// GET /resumes/lookup/full
type UserResume = {
  _id: string; // <-- FIX: Changed from 'id' to '_id' to match your backend response
  id?: string; // <-- Added 'id' as optional just in case
  user_id: string;
  email: string;
  first_name: string;
  last_name?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  work_experience: BE_WorkExperience[];
  projects: BE_Project[];
  education: BE_Education[];
  skills: BE_Skill[];
};

// POST /resumes/:_id/rank-items (Response)
type RankedWorkExperience = BE_WorkExperience & {
  score: number;
};

type RankedProject = BE_Project & {
  score: number;
};

type RankItemsResponse = {
  top_work_experiences: RankedWorkExperience[];
  top_projects: RankedProject[];
};

/* ----------------------- Validation Rules ----------------------- */
const MAX = {
  name: 80,
  email: 120,
  phone: 30,
  location: 80,
  url: 200,
  textShort: 140,
  textLong: 1000,
  jobDescription: 5000, // Max for job description
};

// relaxed + trimmed email validator
const EMAIL_RE = /^\S+@\S+\.\S+$/;

function enforceMax(s: string, max: number) {
  return s.length > max ? s.slice(0, max) : s;
}

type PersonalErrors = Partial<Record<keyof PersonalDetails, string>>;
type ProjectFieldErrors = { title?: string; description?: string };
type ProjectErrors = ProjectFieldErrors[];
type EducationFieldErrors = { institution?: string; degree?: string; start?: string; end?: string; details?: string };
type EducationErrors = EducationFieldErrors[];
type ExperienceFieldErrors = { company?: string; role?: string; start?: string; end?: string; description?: string; achievements?: string };
type ExperienceErrors = ExperienceFieldErrors[];
type SkillFieldErrors = { skill_name?: string; category?: string };
type SkillErrors = SkillFieldErrors[];

function validatePersonal(p: PersonalDetails): PersonalErrors {
  const e: PersonalErrors = {};
  if (!p.name.trim()) e.name = "Name is required.";
  else if (p.name.length > MAX.name) e.name = `Max ${MAX.name} characters.`;

  const emailTrim = p.email.trim();
  if (!emailTrim) e.email = "Email is required.";
  else if (!EMAIL_RE.test(emailTrim)) e.email = "Invalid email format.";
  else if (emailTrim.length > MAX.email) e.email = `Max ${MAX.email} characters.`;

  if (!p.phone.trim()) e.phone = "Phone is required.";
  else if (p.phone.length > MAX.phone) e.phone = `Max ${MAX.phone} characters.`;

  if (p.location.length > MAX.location) e.location = `Max ${MAX.location} characters.`;
  if (p.linkedin && p.linkedin.length > MAX.url) e.linkedin = `Max ${MAX.url} characters.`;
  if (p.github && p.github.length > MAX.url) e.github = `Max ${MAX.url} characters.`;
  return e;
}

function validateProjects(list: ProjectItem[]): ProjectErrors {
  return list.map((pr) => {
    const e: ProjectFieldErrors = {};
    if (!pr.title?.trim()) e.title = "Project title is required.";
    else if (pr.title.length > MAX.textShort) e.title = `Max ${MAX.textShort} characters.`;
    const desc = pr.description ?? "";
    if (!desc.trim()) e.description = "Project description is required.";
    else if (desc.length > MAX.textLong) e.description = `Max ${MAX.textLong} characters.`;
    return e;
  });
}

function validateEducation(list: EducationItem[]): EducationErrors {
  return list.map((ed) => {
    const e: EducationFieldErrors = {};
    if (!ed.institution.trim()) e.institution = "Institution is required.";
    if (!ed.degree.trim()) e.degree = "Degree is required.";
    if (!ed.start.trim()) e.start = "Start date is required.";
    if (!ed.end.trim() && ed.end !== "Present") e.end = "End date is required or choose Present.";
    if (ed.details && ed.details.length > MAX.textLong) e.details = `Max ${MAX.textLong} characters.`;
    return e;
  });
}

function validateExperience(list: ExperienceItem[]): ExperienceErrors {
  return list.map((ex) => {
    const e: ExperienceFieldErrors = {};
    if (!ex.company.trim()) e.company = "Company is required.";
    if (!ex.role.trim()) e.role = "Role is required.";
    if (!ex.start.trim()) e.start = "Start date is required.";
    if (!ex.end.trim() && ex.end !== "Present") e.end = "End date is required or choose Present.";
    if (!ex.description.trim()) e.description = "Description is required.";
    else if (ex.description.length > MAX.textLong) e.description = `Max ${MAX.textLong} characters.`;
    if (ex.achievements && ex.achievements.length > MAX.textLong) e.achievements = `Max ${MAX.textLong} characters.`;
    return e;
  });
}

function validateSkills(list: SkillItem[]): SkillErrors {
  return list.map((sk) => {
    const e: SkillFieldErrors = {};
    if (!sk.skill_name.trim()) e.skill_name = "Skill name is required.";
    else if (sk.skill_name.length > MAX.textShort) e.skill_name = `Max ${MAX.textShort} characters.`;
    if (sk.category && sk.category.length > MAX.textShort) e.category = `Max ${MAX.textShort} characters.`;
    return e;
  });
}

function isEmptyErrors(obj: Record<string, string | undefined>) {
  return Object.values(obj).every((v) => !v);
}
const listValid = (listErrs: Array<Record<string, string | undefined>>) => listErrs.every(isEmptyErrors);

/* ---------------- FIX: Script Loading Helper --------------------- */
// This helper loads a script from a CDN and resolves when it's ready.
const loadedScripts: Record<string, Promise<void>> = {};
function loadScript(src: string): Promise<void> {
  if (src in loadedScripts) {
    return loadedScripts[src];
  }
  loadedScripts[src] = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load script ${src}`));
    document.body.appendChild(script);
  });
  return loadedScripts[src];
}

/* ------------------------ PDF Export Helper --------------------- */
async function exportNodeToPdf(node: HTMLElement, filename = "resume.pdf") {
  try {
    console.log("Starting PDF export...");
    
    // FIX: Load libraries from CDN at runtime
    console.log("Loading PDF libraries...");
    await Promise.all([
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js")
    ]);
    console.log("PDF libraries loaded successfully");

    // Access the libraries from the window object
    const html2canvas = (window as any).html2canvas;
    const jsPDF = (window as any).jspdf?.jsPDF;

    if (!html2canvas || !jsPDF) {
      console.error("Failed to load PDF generation libraries.");
      alert("Failed to load PDF generation libraries. Please check your internet connection and try again.");
      return;
    }

    console.log("Creating temporary sanitized node for PDF...");
    // Create a clean, isolated copy of the node without modern CSS
    const tempContainer = document.createElement('div');
    tempContainer.style.position = 'absolute';
    tempContainer.style.left = '-9999px';
    tempContainer.style.top = '0';
    tempContainer.style.width = node.offsetWidth + 'px';
    tempContainer.style.backgroundColor = '#ffffff';
    tempContainer.style.padding = '20px';
    tempContainer.style.fontFamily = 'Arial, sans-serif';
    tempContainer.style.fontSize = '12pt';
    tempContainer.style.lineHeight = '1.5';
    tempContainer.style.color = '#000000';
    
    // Clone the content
    tempContainer.innerHTML = node.innerHTML;
    document.body.appendChild(tempContainer);

    console.log("Converting HTML to canvas...");
    const canvas = await html2canvas(tempContainer, { 
      scale: 2, 
      useCORS: true, 
      logging: false,
      backgroundColor: '#ffffff',
      windowWidth: tempContainer.scrollWidth,
      windowHeight: tempContainer.scrollHeight
    });
    
    // Remove temporary container
    document.body.removeChild(tempContainer);
    
    console.log("Canvas created, converting to image...");
    const imgData = canvas.toDataURL("image/png");
    console.log("Creating PDF...");
    
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = 595.28;
    const imgWidth = pageWidth - 64;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    
    pdf.addImage(imgData, "PNG", 32, 32, imgWidth, imgHeight);
    console.log("Saving PDF:", filename);
    pdf.save(filename);
    console.log("PDF saved successfully!");
  } catch (error) {
    console.error("Error generating PDF:", error);
    alert("Failed to generate PDF. Error: " + (error as Error).message);
  }
}

/* -------------------------- Small UI Bits ----------------------- */
const Input = ({
  label, value, onChange, placeholder, type = "text", max = 200,
  error, required = false, touched = false, onBlur, showError,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string; max?: number;
  error?: string; required?: boolean; touched?: boolean; onBlur?: () => void; showError?: boolean;
}) => {
  const shouldShowError = (showError ?? touched) && !!error;
  return (
    <label className="block mb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-gray-700">{label} {required && <span className="text-red-600">*</span>}</span>
        <span className={"text-xs " + (value.length > max ? "text-red-600" : "text-gray-400")}>{value.length}/{max}</span>
      </div>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(enforceMax(e.target.value, max))}
        onBlur={onBlur}
        placeholder={placeholder}
        className={"mt-1 w-full rounded-md border px-3 py-2 focus:ring-2 outline-none " + (shouldShowError ? "border-red-500 focus:ring-red-200" : "focus:ring-black/10")}
      />
      {shouldShowError ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </label>
  );
};

const TextArea = ({
  label, value, onChange, rows = 4, placeholder, max = 400,
  error, touched = false, onBlur, required = false, showError, onFocus,
}: {
  label: string; value: string; onChange: (v: string) => void; rows?: number; placeholder?: string; max?: number;
  error?: string; touched?: boolean; onBlur?: () => void; required?: boolean; showError?: boolean; onFocus?: () => void;
}) => {
  const shouldShowError = (showError ?? touched) && !!error;
  return (
    <label className="block mb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-gray-700">{label} {required && <span className="text-red-600">*</span>}</span>
        <span className={"text-xs " + (value.length > max ? "text-red-600" : "text-gray-400")}>{value.length}/{max}</span>
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(enforceMax(e.target.value, max))}
        onBlur={onBlur}
        onFocus={onFocus}
        rows={rows}
        placeholder={placeholder}
        className={"mt-1 w-full rounded-md border px-3 py-2 focus:ring-2 outline-none " + (shouldShowError ? "border-red-500 focus:ring-red-200" : "focus:ring-black/10")}
      />
      {shouldShowError ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </label>
  );
};

const Button = ({
  children, onClick, className = "", disabled, type,
}: {
  children: React.ReactNode; onClick?: () => void; className?: string; disabled?: boolean; type?: "button" | "submit";
}) => (
  <button
    type={type || "button"}
    disabled={disabled}
    onClick={onClick}
    className={"inline-flex items-center justify-center rounded-md border px-3 py-2 text-sm font-medium shadow-sm transition " + (disabled ? "bg-gray-200 text-gray-500 cursor-not-allowed " : "hover:shadow ") + className}
  >
    {children}
  </button>
);

const Section = ({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) => (
  <section className="bg-white rounded-xl shadow-sm border p-5 mb-6">
    <div className="flex items-center justify-between mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {right}
    </div>
    {children}
  </section>
);

const StepIndicator = ({ steps, currentStep }: { steps: string[]; currentStep: number }) => (
  <div className="bg-white rounded-xl shadow-sm border p-5 mb-6">
    <div className="flex items-center justify-between">
      {steps.map((step, idx) => (
        <React.Fragment key={idx}>
          <div className="flex flex-col items-center flex-1">
            <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium ${
              idx < currentStep ? "bg-green-500 text-white" :
              idx === currentStep ? "bg-black text-white" :
              "bg-gray-200 text-gray-600"
            }`}>
              {idx < currentStep ? "✓" : idx + 1}
            </div>
            <div className={`mt-2 text-xs text-center ${idx === currentStep ? "font-semibold" : "text-gray-600"}`}>
              {step}
            </div>
          </div>
          {idx < steps.length - 1 && (
            <div className={`flex-1 h-0.5 -mt-8 ${idx < currentStep ? "bg-green-500" : "bg-gray-200"}`} />
          )}
        </React.Fragment>
      ))}
    </div>
  </div>
);

/* ------------ Month + Year dropdown (fixed version) ------------- */
const MONTHS = ["Jan.", "Feb.", "Mar.", "Apr.", "May", "Jun.", "Jul.", "Aug.", "Sep.", "Oct.", "Nov.", "Dec."];
const years = (() => {
  const cur = new Date().getFullYear();
  const arr: number[] = [];
  for (let y = cur + 7; y >= 1980; y--) arr.push(y);
  return arr;
})();

const MonthYearPicker = ({
  label, value, onChange, required, error, touched, showError, onBlur, presentAllowed = false,
}: {
  label: string; value: string; onChange: (val: string) => void; required?: boolean; error?: string; touched?: boolean;
  showError?: boolean; onBlur?: () => void; presentAllowed?: boolean;
}) => {
  const [monthIdx, setMonthIdx] = React.useState<string>("");
  const [yearVal, setYearVal] = React.useState<string>("");

  React.useEffect(() => {
    if (!value) { setMonthIdx(""); setYearVal(""); return; }
    if (value === "Present") { setMonthIdx(""); setYearVal("Present"); return; }
    const parts = value.trim().split(/\s+/);
    const mi = MONTHS.indexOf(parts[0] || "");
    setMonthIdx(mi >= 0 ? String(mi) : "");
    setYearVal(parts[1] || "");
  }, [value]);

  React.useEffect(() => {
    if (presentAllowed && yearVal === "Present") { onChange("Present"); return; }
    if (monthIdx !== "" && yearVal !== "" && yearVal !== "Present") {
      onChange(`${MONTHS[Number(monthIdx)]} ${yearVal}`);
      return;
    }
    if (value !== "" && !(presentAllowed && yearVal === "Present")) onChange("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthIdx, yearVal, presentAllowed]);

  const shouldShowError = (showError ?? touched) && !!error;
  const isPresent = presentAllowed && yearVal === "Present";

  return (
    <label className="block mb-3">
      <div className="flex items-baseline justify-between">
        <span className="text-sm text-gray-700">{label} {required && <span className="text-red-600">*</span>}</span>
        <span className="text-xs text-gray-400">{value || "—"}</span>
      </div>
      <div className="mt-1 grid grid-cols-2 gap-2">
        <select
          value={isPresent ? "" : monthIdx}
          onChange={(e) => setMonthIdx(e.target.value)}
          onBlur={onBlur}
          disabled={isPresent}
          className={"rounded-md border px-3 py-2 outline-none focus:ring-2 " + (shouldShowError ? "border-red-500 focus:ring-red-200" : "focus:ring-black/10")}
        >
          <option value="">Month</option>
          {MONTHS.map((mm, idx) => (<option key={mm} value={idx}>{mm}</option>))}
        </select>
        <select
          value={yearVal}
          onChange={(e) => setYearVal(e.target.value)}
          onBlur={onBlur}
          className={"rounded-md border px-3 py-2 outline-none focus:ring-2 " + (shouldShowError ? "border-red-500 focus:ring-red-200" : "focus:ring-black/10")}
        >
          <option value="">Year</option>
          {presentAllowed && <option value="Present">Present</option>}
          {years.map((yy) => (<option key={yy} value={yy}>{yy}</option>))}
        </select>
      </div>
      {shouldShowError ? <div className="mt-1 text-xs text-red-600">{error}</div> : null}
    </label>
  );
};

/* ---------------------- Authentication Pages -------------------- */
const LoginPage = ({ 
  onLogin, 
  onSwitchToSignup, 
  onSwitchToForgot 
}: { 
  onLogin: (email: string, password: string) => Promise<void>;
  onSwitchToSignup: () => void;
  onSwitchToForgot: () => void;
}) => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) {
      setError("Please enter both email and password");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onLogin(email, password);
    } catch (err: any) {
      setError(err.message || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Welcome Back</h1>
          <p className="text-gray-600">Sign in to your ResuMatch account</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="you@example.com"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="button"
            onClick={onSwitchToForgot}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            Forgot Password?
          </button>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition shadow-md hover:shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? "Signing In..." : "Sign In"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Don't have an account?{" "}
            <button
              onClick={onSwitchToSignup}
              className="text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Sign Up
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

const SignupPage = ({ 
  onSignup, 
  onSwitchToLogin 
}: { 
  onSignup: (name: string, email: string, password: string) => Promise<void>;
  onSwitchToLogin: () => void;
}) => {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password || !confirmPassword) {
      setError("Please fill in all fields");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }
    if (password.length < 6) {
      setError("Password must be at least 6 characters");
      return;
    }
    setLoading(true);
    setError("");
    try {
      await onSignup(name, email, password);
    } catch (err: any) {
      setError(err.message || "Signup failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Create Account</h1>
          <p className="text-gray-600">Join ResuMatch to build your perfect resume</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Full Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => { setName(e.target.value); setError(""); }}
              placeholder="John Doe"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => { setEmail(e.target.value); setError(""); }}
              placeholder="you@example.com"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Confirm Password</label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
              placeholder="••••••••"
              className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
            />
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <p className="text-sm text-red-800">{error}</p>
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition shadow-md hover:shadow-lg disabled:bg-gray-400 disabled:cursor-not-allowed"
          >
            {loading ? "Creating Account..." : "Create Account"}
          </button>
        </form>

        <div className="mt-6 text-center">
          <p className="text-sm text-gray-600">
            Already have an account?{" "}
            <button
              onClick={onSwitchToLogin}
              className="text-indigo-600 hover:text-indigo-800 font-medium"
            >
              Sign In
            </button>
          </p>
        </div>
      </div>
    </div>
  );
};

const ForgotPasswordPage = ({ 
  onReset, 
  onBack 
}: { 
  onReset: (email: string) => void;
  onBack: () => void;
}) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    onReset(email);
    setSent(true);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Reset Password</h1>
          <p className="text-gray-600">
            {sent ? "Check your email for reset instructions" : "Enter your email to receive reset instructions"}
          </p>
        </div>

        {!sent ? (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-3 rounded-lg border border-gray-300 focus:ring-2 focus:ring-indigo-500 focus:border-transparent outline-none transition"
              />
            </div>

            <button
              type="submit"
              className="w-full bg-indigo-600 text-white py-3 rounded-lg font-semibold hover:bg-indigo-700 transition shadow-md hover:shadow-lg"
            >
              Send Reset Link
            </button>
          </form>
        ) : (
          <div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-4">
            <p className="text-sm text-green-800">
              Reset instructions have been sent to <strong>{email}</strong>
            </p>
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={onBack}
            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium"
          >
            ← Back to Sign In
          </button>
        </div>
      </div>
    </div>
  );
};

const DashboardLanding = ({ 
  user, 
  onSelectMaster, 
  onSelectTailored,
  onLogout 
}: { 
  user: { name: string; email: string };
  onSelectMaster: () => void;
  onSelectTailored: () => void;
  onLogout: () => void;
}) => {
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b shadow-sm">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">ResuMatch Dashboard</h1>
            <p className="text-sm text-gray-600">Welcome back, {user.name}!</p>
          </div>
          <button
            onClick={onLogout}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition"
          >
            Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <h2 className="text-4xl font-bold text-gray-900 mb-4">Choose Your Resume Builder</h2>
          <p className="text-lg text-gray-600">Create a comprehensive master resume or tailor it for a specific job</p>
        </div>

        <div className="grid md:grid-cols-2 gap-8 max-w-5xl mx-auto">
          {/* Master Resume Card */}
          <div
            onClick={onSelectMaster}
            className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all p-8 cursor-pointer border-2 border-transparent hover:border-indigo-500 group"
          >
            <div className="flex items-center justify-center w-16 h-16 bg-indigo-100 rounded-xl mb-6 group-hover:bg-indigo-500 transition">
              <svg className="w-8 h-8 text-indigo-600 group-hover:text-white transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">Master Resume</h3>
            <p className="text-gray-600 mb-4">
              Build your comprehensive master resume with all your skills, experiences, education, and projects.
            </p>
            <ul className="space-y-2 text-sm text-gray-600 mb-6">
              <li className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Multi-step form wizard
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Save all your information
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Download as PDF
              </li>
            </ul>
            <div className="text-indigo-600 font-semibold group-hover:text-indigo-700 flex items-center">
              Get Started
              <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>

          {/* Tailored Resume Card */}
          <div
            onClick={onSelectTailored}
            className="bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all p-8 cursor-pointer border-2 border-transparent hover:border-purple-500 group"
          >
            <div className="flex items-center justify-center w-16 h-16 bg-purple-100 rounded-xl mb-6 group-hover:bg-purple-500 transition">
              <svg className="w-8 h-8 text-purple-600 group-hover:text-white transition" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold text-gray-900 mb-3">Tailored Resume</h3>
            <p className="text-gray-600 mb-4">
              Generate an AI-optimized resume tailored to a specific job description using your master resume.
            </p>
            <ul className="space-y-2 text-sm text-gray-600 mb-6">
              <li className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                AI-powered matching
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Job-specific optimization
              </li>
              <li className="flex items-center">
                <svg className="w-5 h-5 text-green-500 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Instant PDF export
              </li>
            </ul>
            <div className="text-purple-600 font-semibold group-hover:text-purple-700 flex items-center">
              Get Started
              <svg className="w-5 h-5 ml-2 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
};

/* ------------------------------ App ----------------------------- */
const App: React.FC = () => {
  // Authentication state
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentUser, setCurrentUser] = useState<{ email: string; name: string } | null>(null);
  const [authView, setAuthView] = useState<"login" | "signup" | "forgot">("login");
  const [view, setView] = useState<"dashboard" | "master" | "tailored">("dashboard");
  
  const [tab, setTab] = useState<"master" | "tailored">("master");
  
  // Multi-step form state
  const [currentStep, setCurrentStep] = useState(0);
  const [showPreviewPage, setShowPreviewPage] = useState(false); // Show preview page after submit
  const [downloadingPdf, setDownloadingPdf] = useState(false); // PDF download state
  const steps = ["Personal Details", "Education", "Experience", "Skills", "Projects", "Review & Submit"];

  // Personal
  const [personal, setPersonal] = useState<PersonalDetails>({
    name: "",
    email: "",
    phone: "",
    location: "",
    linkedin: "",
    github: "",
  });
  const [personalErrors, setPersonalErrors] = useState<PersonalErrors>({});
  const [personalTouched, setPersonalTouched] = useState<Record<keyof PersonalDetails, boolean>>({
    name: false, email: false, phone: false, location: false, linkedin: false, github: false,
  });
  const [submitAttempted, setSubmitAttempted] = useState(false);

  // Lists
  const [education, setEducation] = useState<EducationItem[]>([
    { institution: "", degree: "", start: "", end: "", details: "" },
  ]);
  const [experience, setExperience] = useState<ExperienceItem[]>([
    { company: "", role: "", start: "", end: "", description: "", achievements: "" },
  ]);
  const [projects, setProjects] = useState<ProjectItem[]>([{ title: "", description: "" }]);
  const [skills, setSkills] = useState<SkillItem[]>([{ skill_name: "", category: "" }]);

  // Errors & touched arrays
  const [projectErrors, setProjectErrors] = useState<ProjectErrors>([{}]);
  const [projectTouched, setProjectTouched] = useState<{ title: boolean; description: boolean }[]>([
    { title: false, description: false },
  ]);
  const [skillErrors, setSkillErrors] = useState<SkillErrors>([{}]);
  const [skillTouched, setSkillTouched] = useState<{ skill_name: boolean; category: boolean }[]>([
    { skill_name: false, category: false },
  ]);
  const [eduErrors, setEduErrors] = useState<EducationErrors>([{} as EducationFieldErrors]);
  const [eduTouched, setEduTouched] = useState<
    { institution: boolean; degree: boolean; start: boolean; end: boolean; details: boolean }[]
  >([{ institution: false, degree: false, start: false, end: false, details: false }]);
  const [expErrors, setExpErrors] = useState<ExperienceErrors>([{} as ExperienceFieldErrors]);
  const [expTouched, setExpTouched] = useState<
    { company: boolean; role: boolean; start: boolean; end: boolean; description: boolean; achievements: boolean }[]
  >([{ company: false, role: false, start: false, end: false, description: false, achievements: false }]);

  // Previews + loading/errors
  const [masterPreviewHTML, setMasterPreviewHTML] = useState("");
  const [tailoredPreviewHTML, setTailoredPreviewHTML] = useState("");
  
  // --- NEW: State for Job Description ---
  const [jobDescription, setJobDescription] = useState("");
  const [jobDescriptionError, setJobDescriptionError] = useState("");
  const [jobDescriptionTouched, setJobDescriptionTouched] = useState(false);

  // Flow flags
  const [posting, setPosting] = useState(false);            // POST /resumes/
  const [lookingUp, setLookingUp] = useState(false);        // GET /resumes/lookup/full
  const [generating, setGenerating] = useState(false);      // POST /resumes/:_id/rank-items
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Step gating
  const [canPreview, setCanPreview] = useState(false);      // after submit succeeds
  const [canGenerate, setCanGenerate] = useState(false);    // after preview returns _id
  const [lookedUpId, setLookedUpId] = useState<string | null>(null);
  
  // --- NEW: State to hold the full UserResume response for rendering ---
  const [masterResumeData, setMasterResumeData] = useState<UserResume | null>(null);


  const masterRef = useRef<HTMLDivElement>(null);
  const tailoredRef = useRef<HTMLDivElement>(null);

  // Keep payload in sync
  const masterPayload: MasterResumeInput = useMemo(
    () => ({ personal, education, experience, projects, skills }),
    [personal, education, experience, projects, skills]
  );

  // Validate on changes
  React.useEffect(() => { setPersonalErrors(validatePersonal(personal)); }, [personal]);
  React.useEffect(() => {
    setProjectErrors(validateProjects(projects));
    setProjectTouched((prev) => {
      const next = [...prev];
      while (next.length < projects.length) next.push({ title: false, description: false });
      while (next.length > projects.length) next.pop();
      return next;
    });
  }, [projects]);
  React.useEffect(() => {
    setSkillErrors(validateSkills(skills));
    setSkillTouched((prev) => {
      const next = [...prev];
      while (next.length < skills.length) next.push({ skill_name: false, category: false });
      while (next.length > skills.length) next.pop();
      return next;
    });
  }, [skills]);
  React.useEffect(() => {
    setEduErrors(validateEducation(education));
    setEduTouched((prev) => {
      const next = [...prev];
      while (next.length < education.length)
        next.push({ institution: false, degree: false, start: false, end: false, details: false });
      while (next.length > education.length) next.pop();
      return next;
    });
  }, [education]);
  React.useEffect(() => {
    setExpErrors(validateExperience(experience));
    setExpTouched((prev) => {
      const next = [...prev];
      while (next.length < experience.length)
        next.push({ company: false, role: false, start: false, end: false, description: false, achievements: false });
      while (next.length > experience.length) next.pop();
      return next;
    });
  }, [experience]);

  // Helpers
  function patch<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, arr: T[], idx: number, next: T) {
    const cloned = [...arr]; cloned[idx] = next; setter(cloned);
  }
  function removeAt<T>(setter: React.Dispatch<React.SetStateAction<T[]>>, arr: T[], idx: number) {
    setter(arr.filter((_, i) => i !== idx));
  }
  const addEducation = () => setEducation([...education, { institution: "", degree: "", start: "", end: "", details: "" }]);
  const addExperience = () => setExperience([...experience, { company: "", role: "", start: "", end: "", description: "", achievements: "" }]);
  const addProject = () => setProjects([...projects, { title: "", description: "" }]);
  const addSkill = () => setSkills([...skills, { skill_name: "", category: "" }]);

  // Overall validity
  const personalValid = isEmptyErrors(personalErrors);
  const projectsValid = listValid(projectErrors);
  const eduValid = listValid(eduErrors);
  const expValid = listValid(expErrors);
  const skillsValid = listValid(skillErrors);
  const isFormValid = personalValid && projectsValid && eduValid && expValid && skillsValid;

  /* ---------------- 1) POST /resumes/ (Submit) ---------------------- */
  const handleSubmitAll = async () => {
    console.log("Submit button clicked!");
    setSubmitAttempted(true);
    const pErrs = validatePersonal(personal);
    const prErrs = validateProjects(projects);
    const edErrs = validateEducation(education);
    const exErrs = validateExperience(experience);
    const skErrs = validateSkills(skills);
    setPersonalErrors(pErrs); setProjectErrors(prErrs); setEduErrors(edErrs); setExpErrors(exErrs); setSkillErrors(skErrs);
    
    // Check for validation errors
    if (!isEmptyErrors(pErrs) || !listValid(prErrs) || !listValid(edErrs) || !listValid(exErrs) || !listValid(skErrs)) {
      console.log("Validation errors:", { pErrs, prErrs, edErrs, exErrs, skErrs });
      setErrorMsg("Please fix all validation errors before submitting.");
      return;
    }

    console.log("Submitting payload:", masterPayload);
    try {
      setErrorMsg(null);
      setPosting(true);
      setMasterPreviewHTML("");
      setTailoredPreviewHTML("");
      setCanPreview(false);
      setCanGenerate(false);
      setLookedUpId(null);
      setMasterResumeData(null);

      const response = await api.post("/resumes/", masterPayload, { headers: { "Content-Type": "application/json" } });
      console.log("Submit response:", response);
      setCanPreview(true); // allow master preview step
    } catch (e: any) {
      console.error("Submit error:", e);
      const errorDetail = e?.response?.data?.detail || e?.message || "Failed to submit resume data.";
      setErrorMsg(errorDetail);
    } finally {
      setPosting(false);
    }
  };

  /* -------- 2) GET /resumes/lookup/full (Preview Master) ----------- */
  const handlePreviewMaster = async () => {
    const email = personal.email.trim();
    if (!email) { setErrorMsg("Email is required to look up your resume."); return; }

    try {
      setErrorMsg(null);
      setLookingUp(true);
      setMasterPreviewHTML("");
      setTailoredPreviewHTML("");
      setCanGenerate(false);
      setLookedUpId(null);
      setMasterResumeData(null);

      // --- FIXED: Fetch the data ---
      const { data } = await api.get<UserResume>("/resumes/lookup/full", { params: { email } });

      // --- FIX: Check for 'data._id' instead of 'data.id' ---
      if (!data?._id) {
        setErrorMsg("Lookup succeeded but no _id was returned.");
        return;
      }
      
      // --- FIX: Save the '_id' from the response ---
      setLookedUpId(String(data._id));
      setMasterResumeData(data); // Save the full backend response
      setCanGenerate(true);

      // --- FIXED: Transform data and render the preview ---
      const feData = transformUserResumeToInput(data);
      setMasterPreviewHTML(fallbackMasterHtml(feData));
      
      // Show preview page
      setShowPreviewPage(true);

    } catch (e: any) {
      setErrorMsg(e?.response?.data?.detail || "Failed to look up master resume.");
    } finally {
      setLookingUp(false);
    }
  };

  /* ---- 3) POST /resumes/:_id/rank-items (Generate Tailored) ------- */
  const handleGenerateTailored = async () => {
    if (!lookedUpId) { setErrorMsg("Please preview master resume first to get an ID."); return; }
    
    setJobDescriptionTouched(true);
    const jd = jobDescription.trim();
    if (!jd) {
      setJobDescriptionError("A job description is required to generate a tailored resume.");
      return;
    }
    if (jd.length > MAX.jobDescription) {
      setJobDescriptionError(`Max ${MAX.jobDescription} characters.`);
      return;
    }
    setJobDescriptionError("");

    try {
      setErrorMsg(null);
      setGenerating(true);
      setTailoredPreviewHTML("");

      // --- FIXED: Send the job_description in the payload ---
      const payload = {
        job_description: jobDescription
      };

      const { data } = await api.post<RankItemsResponse>(
        `/resumes/${encodeURIComponent(lookedUpId)}/rank-items`,
        payload, // Send the payload
        { headers: { "Content-Type": "application/json" } }
      );

      // --- FIXED: Use a new render function for the RankResponse ---
      if (data?.top_work_experiences && data?.top_projects && masterResumeData) {
        setTailoredPreviewHTML(renderTailoredHtml(masterResumeData, data));
      } else {
        setErrorMsg("No tailored content returned by the server.");
      }
    } catch (e: any) {
      setErrorMsg(e?.response?.data?.detail || "Failed to generate tailored resume.");
    } finally {
      setGenerating(false);
    }
  };

  // Convenience for showing field errors
  const showPersonal = (field: keyof PersonalDetails) => submitAttempted || personalTouched[field];
  const showEdu = (idx: number, field: keyof EducationFieldErrors) => submitAttempted || eduTouched[idx]?.[field as keyof typeof eduTouched[number]];
  const showExp = (idx: number, field: keyof ExperienceFieldErrors) => submitAttempted || expTouched[idx]?.[field as keyof typeof expTouched[number]];

  // Multi-step navigation
  const canProceedFromStep = (step: number): boolean => {
    switch (step) {
      case 0: return personalValid; // Personal Details
      case 1: return eduValid;      // Education
      case 2: return expValid;      // Experience
      case 3: return skillsValid;   // Skills
      case 4: return projectsValid; // Projects
      case 5: return true;          // Review & Submit
      default: return false;
    }
  };

  const handleNext = () => {
    // Mark all fields in current step as touched
    if (currentStep === 0) {
      setPersonalTouched({ name: true, email: true, phone: true, location: true, linkedin: true, github: true });
    }
    
    if (canProceedFromStep(currentStep)) {
      setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
    }
  };

  const handlePrevious = () => {
    setCurrentStep((prev) => Math.max(prev - 1, 0));
  };

  const handleDownloadPdf = async (ref: React.RefObject<HTMLDivElement>, filename: string) => {
    if (!ref.current) {
      alert("No content to download");
      return;
    }
    setDownloadingPdf(true);
    try {
      await exportNodeToPdf(ref.current, filename);
    } finally {
      setDownloadingPdf(false);
    }
  };

  // Authentication handlers
  const handleLogin = async (email: string, password: string) => {
    try {
      const response = await api.post("/auth/login", { email, password });
      const { access_token } = response.data;
      
      // Store token in localStorage
      localStorage.setItem("auth_token", access_token);
      
      // Get user info
      const userResponse = await api.get("/auth/me", {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      
      setCurrentUser({ email: userResponse.data.email, name: userResponse.data.name });
      setIsAuthenticated(true);
      setView("dashboard");
    } catch (error: any) {
      console.error("Login error:", error);
      throw new Error(error.response?.data?.detail || "Login failed");
    }
  };

  const handleSignup = async (name: string, email: string, password: string) => {
    try {
      const response = await api.post("/auth/signup", { name, email, password });
      const { access_token } = response.data;
      
      // Store token in localStorage
      localStorage.setItem("auth_token", access_token);
      
      // Get user info
      const userResponse = await api.get("/auth/me", {
        headers: { Authorization: `Bearer ${access_token}` }
      });
      
      setCurrentUser({ email: userResponse.data.email, name: userResponse.data.name });
      setIsAuthenticated(true);
      setView("dashboard");
    } catch (error: any) {
      console.error("Signup error:", error);
      throw new Error(error.response?.data?.detail || "Signup failed");
    }
  };

  const handleForgotPassword = (email: string) => {
    // TODO: Implement password reset endpoint in backend
    console.log("Password reset requested for:", email);
    alert("Password reset functionality will be implemented soon!");
  };

  const handleLogout = () => {
    // Remove token from localStorage
    localStorage.removeItem("auth_token");
    setIsAuthenticated(false);
    setCurrentUser(null);
    setView("dashboard");
    setAuthView("login");
  };

  // Check for existing auth token on mount
  React.useEffect(() => {
    const token = localStorage.getItem("auth_token");
    if (token) {
      // Verify token and get user info
      api.get("/auth/me", {
        headers: { Authorization: `Bearer ${token}` }
      })
      .then(response => {
        setCurrentUser({ email: response.data.email, name: response.data.name });
        setIsAuthenticated(true);
      })
      .catch(() => {
        // Token is invalid, remove it
        localStorage.removeItem("auth_token");
      });
    }
  }, []);

  // Show authentication pages if not logged in
  if (!isAuthenticated) {
    if (authView === "login") {
      return (
        <LoginPage
          onLogin={handleLogin}
          onSwitchToSignup={() => setAuthView("signup")}
          onSwitchToForgot={() => setAuthView("forgot")}
        />
      );
    }
    if (authView === "signup") {
      return (
        <SignupPage
          onSignup={handleSignup}
          onSwitchToLogin={() => setAuthView("login")}
        />
      );
    }
    if (authView === "forgot") {
      return (
        <ForgotPasswordPage
          onReset={handleForgotPassword}
          onBack={() => setAuthView("login")}
        />
      );
    }
  }

  // Show dashboard if authenticated and no specific view selected
  if (isAuthenticated && view === "dashboard" && currentUser) {
    return (
      <DashboardLanding
        user={currentUser}
        onSelectMaster={() => { setView("master"); setTab("master"); }}
        onSelectTailored={() => { setView("tailored"); setTab("tailored"); }}
        onLogout={handleLogout}
      />
    );
  }

  // Show the resume builder (existing functionality)
  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 backdrop-blur bg-white/80 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <button
              onClick={() => setView("dashboard")}
              className="text-gray-600 hover:text-gray-900 transition"
              title="Back to Dashboard"
            >
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </button>
            <h1 className="text-xl font-semibold">Resume Builder Dashboard</h1>
          </div>
          <nav className="flex items-center space-x-2">
            <Button onClick={() => { setTab("master"); setView("master"); }} className={tab === "master" ? "bg-black text-white" : "bg-white"}>Master</Button>
            <Button onClick={() => { setTab("tailored"); setView("tailored"); }} className={tab === "tailored" ? "bg-black text-white" : "bg-white"}>Tailored</Button>
            <button
              onClick={handleLogout}
              className="ml-2 px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900 border border-gray-300 rounded-md hover:bg-gray-50 transition"
            >
              Sign Out
            </button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "master" ? (
          showPreviewPage ? (
            /* Preview Page View */
            <div>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-bold">Master Resume Preview</h2>
                <Button className="bg-white" onClick={() => { setShowPreviewPage(false); setTab("tailored"); }}>
                  Generate Tailored Resume →
                </Button>
              </div>
              <div className="bg-white rounded-xl shadow-sm border p-8">
                <div ref={masterRef} className="max-h-[80vh] overflow-auto">
                  {lookingUp ? (
                    <p className="text-sm text-gray-500">Fetching master preview…</p>
                  ) : masterPreviewHTML ? (
                    <div dangerouslySetInnerHTML={{ __html: masterPreviewHTML }} />
                  ) : (
                    <p className="text-sm text-gray-500">No preview available.</p>
                  )}
                </div>
                <div className="mt-6 flex gap-3">
                  <Button
                    className="bg-black text-white"
                    onClick={() => handleDownloadPdf(masterRef, "Master_Resume.pdf")}
                    disabled={!masterPreviewHTML || downloadingPdf}
                  >
                    {downloadingPdf ? "Generating PDF..." : "Download PDF"}
                  </Button>
                  <Button className="bg-white" onClick={() => setShowPreviewPage(false)}>
                    Back to Form
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            /* Multi-Step Form */
            <div className="max-w-4xl mx-auto">
              <StepIndicator steps={steps} currentStep={currentStep} />

              {/* Step 0: Personal Details */}
              {currentStep === 0 && (
                <Section title="Personal Details">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <Input
                    label="Name"
                    value={personal.name}
                    max={MAX.name}
                    required
                    error={personalErrors.name}
                    touched={personalTouched.name}
                    showError={showPersonal("name")}
                    onBlur={() => setPersonalTouched((t) => ({ ...t, name: true }))}
                    onChange={(v) => setPersonal({ ...personal, name: v })}
                  />
                  <Input
                    label="Email"
                    value={personal.email}
                    max={MAX.email}
                    required
                    error={personalErrors.email}
                    touched={personalTouched.email}
                    showError={showPersonal("email")}
                    onBlur={() => setPersonalTouched((t) => ({ ...t, email: true }))}
                    onChange={(v) => setPersonal({ ...personal, email: v })}
                  />
                  <Input
                    label="Phone"
                    value={personal.phone}
                    max={MAX.phone}
                    required
                    error={personalErrors.phone}
                    touched={personalTouched.phone}
                    showError={showPersonal("phone")}
                    onBlur={() => setPersonalTouched((t) => ({ ...t, phone: true }))}
                    onChange={(v) => setPersonal({ ...personal, phone: v })}
                  />
                  <Input
                    label="Location"
                    value={personal.location}
                    max={MAX.location}
                    error={personalErrors.location}
                    touched={personalTouched.location}
                    showError={showPersonal("location")}
                    onBlur={() => setPersonalTouched((t) => ({ ...t, location: true }))}
                    onChange={(v) => setPersonal({ ...personal, location: v })}
                  />
                  <Input
                    label="LinkedIn URL"
                    value={personal.linkedin}
                    max={MAX.url}
                    error={personalErrors.linkedin}
                    touched={personalTouched.linkedin}
                    showError={showPersonal("linkedin")}
                    onBlur={() => setPersonalTouched((t) => ({ ...t, linkedin: true }))}
                    onChange={(v) => setPersonal({ ...personal, linkedin: v })}
                  />
                  <Input
                    label="GitHub URL"
                    value={personal.github}
                    max={MAX.url}
                    error={personalErrors.github}
                    touched={personalTouched.github}
                    showError={showPersonal("github")}
                    onBlur={() => setPersonalTouched((t) => ({ ...t, github: true }))}
                    onChange={(v) => setPersonal({ ...personal, github: v })}
                  />
                </div>
              </Section>
              )}

              {/* Step 1: Education */}
              {currentStep === 1 && (
                <Section
                title="Education"
                right={<Button className="bg-white" onClick={addEducation}>+ Add</Button>}
              >
                {education.map((ed, idx) => (
                  <div key={idx} className="mb-4 rounded-lg border p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Institution"
                        value={ed.institution}
                        max={MAX.textShort}
                        required
                        error={eduErrors[idx]?.institution}
                        touched={eduTouched[idx]?.institution}
                        showError={showEdu(idx, "institution")}
                        onBlur={() => setEduTouched((t) => { const n = [...t]; (n[idx] ||= {institution:false,degree:false,start:false,end:false,details:false}).institution = true; return n; })}
                        onChange={(v) => patch(setEducation, education, idx, { ...ed, institution: v })}
                      />
                      <Input
                        label="Degree"
                        value={ed.degree}
                        max={MAX.textShort}
                        required
                        error={eduErrors[idx]?.degree}
                        touched={eduTouched[idx]?.degree}
                        showError={showEdu(idx, "degree")}
                        onBlur={() => setEduTouched((t) => { const n = [...t]; (n[idx] ||= {institution:false,degree:false,start:false,end:false,details:false}).degree = true; return n; })}
                        onChange={(v) => patch(setEducation, education, idx, { ...ed, degree: v })}
                      />
                      <MonthYearPicker
                        label="Start"
                        value={ed.start}
                        required
                        error={eduErrors[idx]?.start}
                        touched={eduTouched[idx]?.start}
                        showError={showEdu(idx, "start")}
                        onBlur={() => setEduTouched((t) => { const n = [...t]; (n[idx] ||= {institution:false,degree:false,start:false,end:false,details:false}).start = true; return n; })}
                        onChange={(val) => patch(setEducation, education, idx, { ...ed, start: val })}
                      />
                      <MonthYearPicker
                        label="End"
                        value={ed.end}
                        required
                        presentAllowed
                        error={eduErrors[idx]?.end}
                        touched={eduTouched[idx]?.end}
                        showError={showEdu(idx, "end")}
                        onBlur={() => setEduTouched((t) => { const n = [...t]; (n[idx] ||= {institution:false,degree:false,start:false,end:false,details:false}).end = true; return n; })}
                        onChange={(val) => patch(setEducation, education, idx, { ...ed, end: val })}
                      />
                      <TextArea
                        label="Relevant Coursework (optional)"
                        value={ed.details || ""}
                        max={MAX.textLong}
                        error={eduErrors[idx]?.details}
                        touched={eduTouched[idx]?.details}
                        showError={showEdu(idx, "details")}
                        onBlur={() => setEduTouched((t) => { const n = [...t]; (n[idx] ||= {institution:false,degree:false,start:false,end:false,details:false}).details = true; return n; })}
                        onChange={(v) => patch(setEducation, education, idx, { ...ed, details: v })}
                      />
                    </div>
                    <div className="mt-2">
                      <Button className="bg-white" onClick={() => {
                        removeAt(setEducation, education, idx);
                        setEduTouched((t) => t.filter((_, i) => i !== idx));
                        setEduErrors((e) => e.filter((_, i) => i !== idx));
                      }}>Remove</Button>
                    </div>
                  </div>
                ))}
              </Section>
              )}

              {/* Step 2: Experience */}
              {currentStep === 2 && (
                <Section
                title="Experience"
                right={<Button className="bg-white" onClick={addExperience}>+ Add</Button>}
              >
                {experience.map((ex, idx) => (
                  <div key={idx} className="mb-4 rounded-lg border p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Company"
                        value={ex.company}
                        max={MAX.textShort}
                        required
                        error={expErrors[idx]?.company}
                        touched={expTouched[idx]?.company}
                        showError={showExp(idx, "company")}
                        onBlur={() => setExpTouched((t) => { const n = [...t]; (n[idx] ||= {company:false,role:false,start:false,end:false,description:false,achievements:false}).company = true; return n; })}
                        onChange={(v) => patch(setExperience, experience, idx, { ...ex, company: v })}
                      />
                      <Input
                        label="Role"
                        value={ex.role}
                        max={MAX.textShort}
                        required
                        error={expErrors[idx]?.role}
                        touched={expTouched[idx]?.role}
                        showError={showExp(idx, "role")}
                        onBlur={() => setExpTouched((t) => { const n = [...t]; (n[idx] ||= {company:false,role:false,start:false,end:false,description:false,achievements:false}).role = true; return n; })}
                        onChange={(v) => patch(setExperience, experience, idx, { ...ex, role: v })}
                      />
                      <MonthYearPicker
                        label="Start"
                        value={ex.start}
                        required
                        error={expErrors[idx]?.start}
                        touched={expTouched[idx]?.start}
                        showError={showExp(idx, "start")}
                        onBlur={() => setExpTouched((t) => { const n = [...t]; (n[idx] ||= {company:false,role:false,start:false,end:false,description:false,achievements:false}).start = true; return n; })}
                        onChange={(val) => patch(setExperience, experience, idx, { ...ex, start: val })}
                      />
                      <MonthYearPicker
                        label="End"
                        value={ex.end}
                        required
                        presentAllowed
                        error={expErrors[idx]?.end}
                        touched={expTouched[idx]?.end}
                        showError={showExp(idx, "end")}
                        onBlur={() => setExpTouched((t) => { const n = [...t]; (n[idx] ||= {company:false,role:false,start:false,end:false,description:false,achievements:false}).end = true; return n; })}
                        onChange={(val) => patch(setExperience, experience, idx, { ...ex, end: val })}
                      />
                    </div>

                    <TextArea
                      label="Description"
                      value={ex.description}
                      max={MAX.textLong}
                      required
                      error={expErrors[idx]?.description}
                      touched={expTouched[idx]?.description}
                      showError={showExp(idx, "description")}
                      onBlur={() => setExpTouched((t) => { const n = [...t]; (n[idx] ||= {company:false,role:false,start:false,end:false,description:false,achievements:false}).description = true; return n; })}
                      onChange={(v) => patch(setExperience, experience, idx, { ...ex, description: v })}
                    />

                    <TextArea
                      label="Achievements (optional)"
                      value={ex.achievements || ""}
                      max={MAX.textLong}
                      error={expErrors[idx]?.achievements}
                      touched={expTouched[idx]?.achievements}
                      showError={showExp(idx, "achievements")}
                      onBlur={() => setExpTouched((t) => { const n = [...t]; (n[idx] ||= {company:false,role:false,start:false,end:false,description:false,achievements:false}).achievements = true; return n; })}
                      onChange={(v) => patch(setExperience, experience, idx, { ...ex, achievements: v })}
                    />

                    <div className="mt-2">
                      <Button className="bg-white" onClick={() => {
                        removeAt(setExperience, experience, idx);
                        setExpTouched((t) => t.filter((_, i) => i !== idx));
                        setExpErrors((e) => e.filter((_, i) => i !== idx));
                      }}>Remove</Button>
                    </div>
                  </div>
                ))}
              </Section>
              )}

              {/* Step 3: Skills */}
              {currentStep === 3 && (
                <Section title="Skills" right={<Button className="bg-white" onClick={addSkill}>+ Add</Button>}>
                {skills.map((sk, idx) => (
                  <div key={idx} className="mb-4 rounded-lg border p-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <Input
                        label="Skill Name"
                        value={sk.skill_name}
                        max={MAX.textShort}
                        required
                        placeholder="e.g., Python, React, AWS"
                        error={skillErrors[idx]?.skill_name}
                        touched={skillTouched[idx]?.skill_name}
                        showError={submitAttempted || skillTouched[idx]?.skill_name}
                        onBlur={() => setSkillTouched((t) => { const next = [...t]; if (!next[idx]) next[idx] = { skill_name: false, category: false }; next[idx].skill_name = true; return next; })}
                        onChange={(v) => patch(setSkills, skills, idx, { ...sk, skill_name: v })}
                      />
                      <Input
                        label="Category (optional)"
                        value={sk.category}
                        max={MAX.textShort}
                        placeholder="e.g., Language, Framework, Tool"
                        error={skillErrors[idx]?.category}
                        touched={skillTouched[idx]?.category}
                        showError={submitAttempted || skillTouched[idx]?.category}
                        onBlur={() => setSkillTouched((t) => { const next = [...t]; if (!next[idx]) next[idx] = { skill_name: false, category: false }; next[idx].category = true; return next; })}
                        onChange={(v) => patch(setSkills, skills, idx, { ...sk, category: v })}
                      />
                    </div>
                    <div className="mt-2">
                      <Button className="bg-white" onClick={() => {
                        removeAt(setSkills, skills, idx);
                        setSkillTouched((t) => t.filter((_, i) => i !== idx));
                        setSkillErrors((e) => e.filter((_, i) => i !== idx));
                      }}>Remove</Button>
                    </div>
                  </div>
                ))}
              </Section>
              )}

              {/* Step 4: Projects */}
              {currentStep === 4 && (
                <Section title="Projects" right={<Button className="bg-white" onClick={addProject}>+ Add</Button>}>
                {projects.map((pr, idx) => (
                  <div key={idx} className="mb-4 rounded-lg border p-3">
                    <Input
                      label="Title"
                      value={pr.title}
                      max={MAX.textShort}
                      required
                      error={projectErrors[idx]?.title}
                      touched={projectTouched[idx]?.title}
                      showError={submitAttempted || projectTouched[idx]?.title}
                      onBlur={() => setProjectTouched((t) => { const next = [...t]; if (!next[idx]) next[idx] = { title: false, description: false }; next[idx].title = true; return next; })}
                      onChange={(v) => patch(setProjects, projects, idx, { ...pr, title: v })}
                    />
                    <TextArea
                      label="Description"
                      value={pr.description || ""}
                      max={MAX.textLong}
                      rows={6}
                      required
                      error={projectErrors[idx]?.description}
                      touched={projectTouched[idx]?.description}
                      showError={submitAttempted || projectTouched[idx]?.description}
                      onBlur={() => setProjectTouched((t) => { const next = [...t]; if (!next[idx]) next[idx] = { title: false, description: false }; next[idx].description = true; return next; })}
                      onChange={(v) => patch(setProjects, projects, idx, { ...pr, description: v })}
                    />
                    <div className="mt-2">
                      <Button className="bg-white" onClick={() => {
                        removeAt(setProjects, projects, idx);
                        setProjectTouched((t) => t.filter((_, i) => i !== idx));
                        setProjectErrors((e) => e.filter((_, i) => i !== idx));
                      }}>Remove</Button>
                    </div>
                  </div>
                ))}
              </Section>
              )}

              {/* Step 5: Review & Submit */}
              {currentStep === 5 && (
                <Section title="Review & Submit">
                  <div className="space-y-4">
                    <div className="bg-gray-50 rounded-lg p-4">
                      <h3 className="font-semibold text-lg mb-3">Review Your Information</h3>
                      <div className="space-y-2 text-sm">
                        <div><span className="font-medium">Name:</span> {personal.name || "—"}</div>
                        <div><span className="font-medium">Email:</span> {personal.email || "—"}</div>
                        <div><span className="font-medium">Phone:</span> {personal.phone || "—"}</div>
                        <div><span className="font-medium">Education:</span> {education.length} entry(ies)</div>
                        <div><span className="font-medium">Experience:</span> {experience.length} entry(ies)</div>
                        <div><span className="font-medium">Skills:</span> {skills.length} skill(s)</div>
                        <div><span className="font-medium">Projects:</span> {projects.length} project(s)</div>
                      </div>
                    </div>

                    {/* Form Validation Status */}
                    {!isFormValid && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                        <p className="text-sm text-red-800 font-medium mb-2">⚠️ Please fix the following issues:</p>
                        <ul className="text-sm text-red-700 space-y-1 list-disc list-inside">
                          {!personalValid && <li>Personal Details has errors</li>}
                          {!eduValid && <li>Education has errors</li>}
                          {!expValid && <li>Experience has errors</li>}
                          {!skillsValid && <li>Skills has errors</li>}
                          {!projectsValid && <li>Projects has errors</li>}
                        </ul>
                      </div>
                    )}
                    
                    <div className="flex gap-3">
                      <Button
                        className="bg-black text-white"
                        onClick={handleSubmitAll}
                        disabled={!isFormValid || posting}
                      >
                        {posting ? "Submitting…" : "Submit Resume"}
                      </Button>

                      <Button
                        className="bg-blue-600 text-white"
                        onClick={handlePreviewMaster}
                        disabled={!canPreview || lookingUp}
                      >
                        {lookingUp ? "Loading…" : "Preview Resume"}
                      </Button>
                    </div>

                    {errorMsg && (
                      <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                        <p className="text-sm text-red-800 font-medium">❌ Error:</p>
                        <p className="text-sm text-red-700 mt-1">{errorMsg}</p>
                      </div>
                    )}
                    {canPreview && !lookedUpId && (
                      <div className="bg-green-50 border border-green-200 rounded-lg p-3">
                        <p className="text-sm text-green-800">✓ Data submitted successfully! Click "Preview Resume" to view.</p>
                      </div>
                    )}
                  </div>
                </Section>
              )}

              {/* Navigation Buttons */}
              <div className="flex justify-between mt-6">
                <Button
                  className="bg-white"
                  onClick={handlePrevious}
                  disabled={currentStep === 0}
                >
                  ← Previous
                </Button>
                
                {currentStep < steps.length - 1 && (
                  <Button
                    className="bg-black text-white"
                    onClick={handleNext}
                    disabled={!canProceedFromStep(currentStep)}
                  >
                    Next →
                  </Button>
                )}
              </div>

              {/* Validation hint */}
              {!canProceedFromStep(currentStep) && currentStep < steps.length - 1 && (
                <div className="text-sm text-red-600 text-center mt-2">
                  Please fill all required fields to proceed.
                </div>
              )}
            </div>
          )
        ) : (
          /* ---------------------- Tailored Tab ---------------------- */
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div>
              {/* --- NEW: Job Description Input --- */}
              <Section title="Generate Tailored Resume">
                <p className="text-sm text-gray-600 mb-3">
                  Paste a job description below, then click "Generate" to get an AI-powered resume tailored for that specific job.
                </p>
                <TextArea
                  label="Job Description"
                  value={jobDescription}
                  max={MAX.jobDescription}
                  rows={15}
                  required
                  placeholder="Paste the full job description here..."
                  error={jobDescriptionError}
                  touched={jobDescriptionTouched}
                  showError={jobDescriptionTouched}
                  onBlur={() => setJobDescriptionTouched(true)}
                  onChange={(v) => {
                    setJobDescription(v);
                    if (v) setJobDescriptionError("");
                  }}
                />
                
                <div className="mt-3 flex gap-3">
                  <Button
                    className="bg-black text-white"
                    onClick={handleGenerateTailored}
                    disabled={!canGenerate || generating}
                  >
                    {generating ? "Generating…" : "Generate Tailored Resume"}
                  </Button>
                </div>
                {!canGenerate && (
                   <p className="mt-2 text-xs text-gray-500">
                    Please go to the "Master" tab and use "Submit" and "Preview Master Resume" first.
                  </p>
                )}
                {lookedUpId && (
                  <p className="mt-2 text-xs text-gray-500">
                    Using <code>_id</code>: <code>{lookedUpId}</code>
                  </p>
                )}
                {errorMsg && <p className="mt-2 text-xs text-red-600">{errorMsg}</p>}
              </Section>
            </div>

            <div>
              <Section title="Tailored Resume Preview">
                <div ref={tailoredRef} className="bg-white border rounded-lg p-4 max-h-[80vh] overflow-auto">
                  {generating ? (
                    <p className="text-sm text-gray-500">Generating tailored resume…</p>
                  ) : tailoredPreviewHTML ? (
                    <div dangerouslySetInnerHTML={{ __html: tailoredPreviewHTML }} />
                  ) : (
                    <p className="text-sm text-gray-500">No tailored preview yet.</p>
                  )}
                </div>
                <div className="mt-3">
                  <Button
                    className="bg-white"
                    onClick={() => handleDownloadPdf(tailoredRef, "Tailored_Resume.pdf")}
                    disabled={!tailoredPreviewHTML || downloadingPdf}
                  >
                    {downloadingPdf ? "Generating PDF..." : "Download Tailored PDF"}
                  </Button>
                </div>
              </Section>
            </div>
          </div>
        )}
      </main>

      <footer className="text-center py-6 text-xs text-gray-500">
        Flow: Submit → Preview Master Resume → Generate Tailored Resume
      </footer>
    </div>
  );
};

export default App;

/* ---------------------- Render Helpers ------------------------- */
function escapeHtml(s: string) {
  if (!s) return "";
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}
function sectionBlock(title: string, inner: string) {
  if (!inner || !inner.trim()) return "";
  return `<div style="margin-top: 16px;"><div style="font-weight: 600; border-bottom: 1px solid #000; padding-bottom: 4px; font-size: 14pt; color: #000000;">${escapeHtml(title)}</div><div style="margin-top: 8px;">${inner}</div></div>`;
}

/**
 * --- NEW: Transformer Function ---
 * Converts the backend's UserResume into the frontend's MasterResumeInput.
 */
function transformUserResumeToInput(be: UserResume): MasterResumeInput {
  return {
    personal: {
      name: `${be.first_name || ''} ${be.last_name || ''}`.trim(),
      email: be.email || '',
      phone: be.phone || '',
      location: '', // Not in UserResume, but in Ingest. Keep it empty.
      linkedin: be.linkedin_url || '',
      github: be.portfolio_url || '',
    },
    education: be.education.map(ed => ({
      institution: ed.institution_name || '',
      degree: ed.degree || '',
      start: ed.start_date || '',
      end: ed.graduation_date || '',
      details: ed.field_of_study || '',
    })),
    experience: be.work_experience.map(ex => ({
      company: ex.company_name || '',
      role: ex.job_title || '',
      start: ex.start_date || '',
      end: ex.end_date || '',
      // Combine bullets back into a single string for the form
      description: ex.description_bullets?.join('\n') || '',
      achievements: '', // Not in UserResume, but in Ingest. Keep it empty.
    })),
    projects: be.projects.map(pr => ({
      title: pr.project_name || '',
      // Combine bullets back into a single string for the form
      description: pr.description_bullets?.join('\n') || '',
    })),
    skills: be.skills.map(sk => ({
      skill_name: sk.skill_name || '',
      category: sk.category || '',
    })),
  };
}


/**
 * Renders the Master Resume HTML from the frontend's form data.
 */
function fallbackMasterHtml(data: MasterResumeInput): string {
  const p = data.personal;
  
  // Group skills by category
  const groupedSkills = data.skills.reduce((acc, sk) => {
    const cat = sk.category?.trim() || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(sk.skill_name);
    return acc;
  }, {} as Record<string, string[]>);
  
  const skillsHtml = Object.keys(groupedSkills).length > 0 
    ? Object.entries(groupedSkills).map(([cat, skillNames]) => `
        <div>
          <span class="font-medium" style="font-size: 11pt;">${escapeHtml(cat)}:</span>
          <span style="font-size: 11pt;"> ${skillNames.map(escapeHtml).join(", ")}</span>
        </div>
      `).join("")
    : "";
  
  return `
    <div style="font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5;">
      <div style="text-align: center;">
        <div style="font-size: 18pt; font-weight: 600;">${escapeHtml(p.name || "Your Name")}</div>
        <div style="color: #666666; font-size: 10pt;">${[p.email, p.phone, p.location].filter(Boolean).map(escapeHtml).join(" • ")}</div>
        <div style="color: #666666; font-size: 10pt;">${[p.linkedin, p.github].filter(Boolean).map(escapeHtml).join(" • ")}</div>
      </div>
      ${sectionBlock("Education", data.education.map(ed => `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 500; font-size: 12pt;">${escapeHtml(ed.institution)} — ${escapeHtml(ed.degree)}</div>
          <div style="color: #666666; font-size: 10pt;">${escapeHtml(ed.start)} – ${escapeHtml(ed.end)}</div>
          ${ed.details ? `<div style="margin-top: 4px; font-size: 11pt;">${escapeHtml(ed.details)}</div>` : ""}
        </div>
      `).join(""))}
      ${sectionBlock("Experience", data.experience.map(ex => `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 500; font-size: 12pt;">${escapeHtml(ex.role)} — ${escapeHtml(ex.company)}</div>
          <div style="color: #666666; font-size: 10pt;">${escapeHtml(ex.start)} – ${escapeHtml(ex.end)}</div>
          ${ex.description ? `<ul style="list-style-type: disc; padding-left: 20px; margin-top: 4px; font-size: 11pt;">${ex.description.split('\n').map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
          ${ex.achievements ? `<div style="margin-top: 4px; font-size: 11pt;">${escapeHtml(ex.achievements)}</div>` : ""}
        </div>
      `).join(""))}
      ${sectionBlock("Projects", data.projects.map(pr => `
        <div style="margin-bottom: 12px;">
          <div style="font-weight: 500; font-size: 12pt;">${escapeHtml(pr.title)}</div>
          ${pr.description ? `<ul style="list-style-type: disc; padding-left: 20px; margin-top: 4px; font-size: 11pt;">${pr.description.split('\n').map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
        </div>
      `).join(""))}
      ${sectionBlock("Skills", skillsHtml)}
    </div>`;
}

/**
 * --- NEW: Renders the Tailored Resume HTML ---
 * Uses the full master resume for personal/education, but only the 
 * top-ranked items from the RankResponse.
 */
function renderTailoredHtml(master: UserResume, ranked: RankItemsResponse): string {
  const p = master;
  const personalHtml = `
    <div style="text-align: center;">
      <div style="font-size: 18pt; font-weight: 600;">${escapeHtml(p.first_name || '')} ${escapeHtml(p.last_name || '')}</div>
      <div style="color: #666666; font-size: 10pt;">${[p.email, p.phone].filter(Boolean).map(v => escapeHtml(v || '')).join(" • ")}</div>
      <div style="color: #666666; font-size: 10pt;">${[p.linkedin_url, p.portfolio_url].filter(Boolean).map(v => escapeHtml(v || '')).join(" • ")}</div>
    </div>`;
  
  const educationHtml = sectionBlock("Education", master.education.map(ed => `
    <div style="margin-bottom: 12px;">
      <div style="font-weight: 500; font-size: 12pt;">${escapeHtml(ed.institution_name)} — ${escapeHtml(ed.degree)}</div>
      <div style="color: #666666; font-size: 10pt;">${escapeHtml(ed.start_date || '')} – ${escapeHtml(ed.graduation_date || '')}</div>
      ${ed.field_of_study ? `<div style="margin-top: 4px; font-size: 11pt;">${escapeHtml(ed.field_of_study)}</div>` : ""}
    </div>
  `).join(""));

  const workExHtml = sectionBlock("Relevant Experience", ranked.top_work_experiences.map(ex => `
    <div style="margin-bottom: 12px;">
      <div style="font-weight: 500; font-size: 12pt;">${escapeHtml(ex.job_title)} — ${escapeHtml(ex.company_name)}</div>
      <div style="color: #666666; font-size: 10pt;">${escapeHtml(ex.start_date || '')} – ${escapeHtml(ex.end_date || '')}</div>
      ${ex.description_bullets ? `<ul style="list-style-type: disc; padding-left: 20px; margin-top: 4px; font-size: 11pt;">${ex.description_bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
    </div>
  `).join(""));

  const projectsHtml = sectionBlock("Relevant Projects", ranked.top_projects.map(pr => `
    <div style="margin-bottom: 12px;">
      <div style="font-weight: 500; font-size: 12pt;">${escapeHtml(pr.project_name)}</div>
      ${pr.description_bullets ? `<ul style="list-style-type: disc; padding-left: 20px; margin-top: 4px; font-size: 11pt;">${pr.description_bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
    </div>
  `).join(""));
  
  // Group skills by category
  const groupedSkills = master.skills.reduce((acc, sk) => {
    const cat = sk.category?.trim() || "Other";
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(sk.skill_name);
    return acc;
  }, {} as Record<string, string[]>);
  
  const skillsHtml = sectionBlock("Skills", Object.entries(groupedSkills).map(([cat, skillNames]) => `
    <div>
      <span style="font-weight: 500; font-size: 11pt;">${escapeHtml(cat)}:</span>
      <span style="font-size: 11pt;"> ${skillNames.map(escapeHtml).join(", ")}</span>
    </div>
  `).join(""));
  
  return `<div style="font-family: Arial, sans-serif; font-size: 12pt; line-height: 1.5;">${personalHtml}${workExHtml}${projectsHtml}${educationHtml}${skillsHtml}</div>`;
}