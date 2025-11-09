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

// This is the shape of the data in the React forms
type MasterResumeInput = {
  personal: PersonalDetails;
  education: EducationItem[];
  experience: ExperienceItem[];
  projects: ProjectItem[];
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
  skills: any[]; // 'skills' model not fully defined, but we don't use it
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

function isEmptyErrors(obj: Record<string, string | undefined>) {
  return Object.values(obj).every((v) => !v);
}
const listValid = (listErrs: Array<Record<string, string | undefined>>) => listErrs.every(isEmptyErrors);

/* ---------------- FIX: Script Loading Helper --------------------- */
// This helper loads a script from a CDN and resolves when it's ready.
const loadedScripts: Record<string, Promise<void>> = {};
function loadScript(src: string): Promise<void> {
  if (loadedScripts[src]) {
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
    // FIX: Load libraries from CDN at runtime
    await Promise.all([
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js"),
      loadScript("https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js")
    ]);

    // Access the libraries from the window object
    const html2canvas = (window as any).html2canvas;
    const jsPDF = (window as any).jspdf.jsPDF;

    if (!html2canvas || !jsPDF) {
      console.error("Failed to load PDF generation libraries.");
      return;
    }

    const canvas = await html2canvas(node, { scale: 2, useCORS: true });
    const imgData = canvas.toDataURL("image/png");
    const pdf = new jsPDF({ unit: "pt", format: "a4" });
    const pageWidth = 595.28;
    const imgWidth = pageWidth - 64;
    const imgHeight = (canvas.height * imgWidth) / canvas.width;
    pdf.addImage(imgData, "PNG", 32, 32, imgWidth, imgHeight);
    pdf.save(filename);
  } catch (error) {
    console.error("Error generating PDF:", error);
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

/* ------------------------------ App ----------------------------- */
const App: React.FC = () => {
  const [tab, setTab] = useState<"master" | "tailored">("master");

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

  // Errors & touched arrays
  const [projectErrors, setProjectErrors] = useState<ProjectErrors>([{}]);
  const [projectTouched, setProjectTouched] = useState<{ title: boolean; description: boolean }[]>([
    { title: false, description: false },
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
    () => ({ personal, education, experience, projects }),
    [personal, education, experience, projects]
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

  // Overall validity
  const personalValid = isEmptyErrors(personalErrors);
  const projectsValid = listValid(projectErrors);
  const eduValid = listValid(eduErrors);
  const expValid = listValid(expErrors);
  const isFormValid = personalValid && projectsValid && eduValid && expValid;

  /* ---------------- 1) POST /resumes/ (Submit) ---------------------- */
  const handleSubmitAll = async () => {
    setSubmitAttempted(true);
    const pErrs = validatePersonal(personal);
    const prErrs = validateProjects(projects);
    const edErrs = validateEducation(education);
    const exErrs = validateExperience(experience);
    setPersonalErrors(pErrs); setProjectErrors(prErrs); setEduErrors(edErrs); setExpErrors(exErrs);
    if (!isEmptyErrors(pErrs) || !listValid(prErrs) || !listValid(edErrs) || !listValid(exErrs)) return;

    try {
      setErrorMsg(null);
      setPosting(true);
      setMasterPreviewHTML("");
      setTailoredPreviewHTML("");
      setCanPreview(false);
      setCanGenerate(false);
      setLookedUpId(null);
      setMasterResumeData(null);

      await api.post("/resumes/", masterPayload, { headers: { "Content-Type": "application/json" } });
      setCanPreview(true); // allow master preview step
    } catch (e: any) {
      setErrorMsg(e?.response?.data?.detail || "Failed to submit resume data.");
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

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="sticky top-0 backdrop-blur bg-white/80 border-b">
        <div className="max-w-6xl mx-auto px-4 py-3 flex justify-between items-center">
          <h1 className="text-xl font-semibold">Resume Builder Dashboard</h1>
          <nav className="space-x-2">
            <Button onClick={() => setTab("master")} className={tab === "master" ? "bg-black text-white" : "bg-white"}>Master</Button>
            <Button onClick={() => setTab("tailored")} className={tab === "tailored" ? "bg-black text-white" : "bg-white"}>Tailored</Button>
          </nav>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {tab === "master" ? (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Forms */}
            <div>
              {/* Personal */}
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

              {/* Education */}
              <Section
                title="Education"
                right={<Button className="bg-white" onClick={() => setEducation([...education, { institution: "", degree: "", start: "", end: "", details: "" }])}>+ Add</Button>}
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

              {/* Experience */}
              <Section
                title="Experience"
                right={<Button className="bg-white" onClick={() => setExperience([...experience, { company: "", role: "", start: "", end: "", description: "", achievements: "" }])}>+ Add</Button>}
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

              {/* Projects */}
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

              {/* Actions (your exact labels) */}
              <div className="flex flex-wrap gap-3 items-center">
                <Button
                  className="bg-black text-white"
                  onClick={handleSubmitAll}
                  disabled={!isFormValid || posting}
                >
                  {posting ? "Submitting…" : "Submit"}
                </Button>

                <Button
                  className="bg-white"
                  onClick={handlePreviewMaster}
                  disabled={!canPreview || lookingUp}
                >
                  {lookingUp ? "Loading Preview…" : "Preview Master Resume"}
                </Button>

                <Button
                  className="bg-white"
                  onClick={() => masterRef.current && exportNodeToPdf(masterRef.current, "Master_Resume.pdf")}
                  disabled={!masterPreviewHTML}
                >
                  Download Master PDF
                </Button>
              </div>

              {/* Inline step hints */}
              <div className="mt-2 space-y-1 text-xs text-gray-500">
                {!isFormValid && <div>Fill required fields to enable <b>Submit</b>.</div>}
                {isFormValid && !canPreview && !posting && <div>Click <b>Submit</b> to send data.</div>}
                {canPreview && !canGenerate && !lookingUp && <div>Click <b>Preview Master Resume</b> to fetch <code>_id</code>.</div>}
                {lookedUpId && <div>Current resume <code>_id</code>: <code>{lookedUpId}</code></div>}
                {errorMsg && <div className="text-red-600">{errorMsg}</div>}
              </div>
            </div>

            {/* Right: Previews */}
            <div className="space-y-6">
              <Section title="Master Resume Preview">
                <div ref={masterRef} className="bg-white border rounded-lg p-4 max-h-[80vh] overflow-auto">
                  {posting || lookingUp ? (
                    <p className="text-sm text-gray-500">
                      {posting ? "Submitting data…" : "Fetching master preview…"}
                    </p>
                  ) : masterPreviewHTML ? (
                    <div dangerouslySetInnerHTML={{ __html: masterPreviewHTML }} />
                  ) : (
                    <p className="text-sm text-gray-500">No master preview yet.</p>
                  )}
                </div>
              </Section>
            </div>
          </div>
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
                    onClick={() => tailoredRef.current && exportNodeToPdf(tailoredRef.current, "Tailored_Resume.pdf")}
                    disabled={!tailoredPreviewHTML}
                  >
                    Download Tailored PDF
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
  return `<div class="mt-4"><div class="font-semibold border-b pb-1" style="font-size: 14pt; color: black;">${escapeHtml(title)}</div><div class="mt-1 space-y-2">${inner}</div></div>`;
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
  };
}


/**
 * Renders the Master Resume HTML from the frontend's form data.
 */
function fallbackMasterHtml(data: MasterResumeInput): string {
  const p = data.personal;
  return `
    <div class="font-sans text-[12pt] leading-relaxed">
      <div class="text-center">
        <div class="text-[18pt] font-semibold">${escapeHtml(p.name || "Your Name")}</div>
        <div class="text-gray-600 text-[10pt]">${[p.email, p.phone, p.location].filter(Boolean).map(escapeHtml).join(" • ")}</div>
        <div class="text-gray-600 text-[10pt]">${[p.linkedin, p.github].filter(Boolean).map(escapeHtml).join(" • ")}</div>
      </div>
      ${sectionBlock("Education", data.education.map(ed => `
        <div>
          <div class="font-medium" style="font-size: 12pt;">${escapeHtml(ed.institution)} — ${escapeHtml(ed.degree)}</div>
          <div class="text-gray-600 text-[10pt]">${escapeHtml(ed.start)} – ${escapeHtml(ed.end)}</div>
          ${ed.details ? `<div class="mt-1" style="font-size: 11pt;">${escapeHtml(ed.details)}</div>` : ""}
        </div>
      `).join(""))}
      ${sectionBlock("Experience", data.experience.map(ex => `
        <div>
          <div class="font-medium" style="font-size: 12pt;">${escapeHtml(ex.role)} — ${escapeHtml(ex.company)}</div>
          <div class="text-gray-600 text-[10pt]">${escapeHtml(ex.start)} – ${escapeHtml(ex.end)}</div>
          ${ex.description ? `<ul class="list-disc list-outside pl-5 mt-1" style="font-size: 11pt;">${ex.description.split('\n').map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
          ${ex.achievements ? `<div class="mt-1" style="font-size: 11pt;">${escapeHtml(ex.achievements)}</div>` : ""}
        </div>
      `).join(""))}
      ${sectionBlock("Projects", data.projects.map(pr => `
        <div>
          <div class="font-medium" style="font-size: 12pt;">${escapeHtml(pr.title)}</div>
          ${pr.description ? `<ul class="list-disc list-outside pl-5 mt-1" style="font-size: 11pt;">${pr.description.split('\n').map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
        </div>
      `).join(""))}
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
    <div class="text-center">
      <div class="text-[18pt] font-semibold">${escapeHtml(p.first_name)} ${escapeHtml(p.last_name)}</div>
      <div class="text-gray-600 text-[10pt]">${[p.email, p.phone].filter(Boolean).map(escapeHtml).join(" • ")}</div>
      <div class="text-gray-600 text-[10pt]">${[p.linkedin_url, p.portfolio_url].filter(Boolean).map(escapeHtml).join(" • ")}</div>
    </div>`;
  
  const educationHtml = sectionBlock("Education", master.education.map(ed => `
    <div>
      <div class="font-medium" style="font-size: 12pt;">${escapeHtml(ed.institution_name)} — ${escapeHtml(ed.degree)}</div>
      <div class="text-gray-600 text-[10pt]">${escapeHtml(ed.start_date || '')} – ${escapeHtml(ed.graduation_date || '')}</div>
      ${ed.field_of_study ? `<div class="mt-1" style="font-size: 11pt;">${escapeHtml(ed.field_of_study)}</div>` : ""}
    </div>
  `).join(""));

  const workExHtml = sectionBlock("Relevant Experience", ranked.top_work_experiences.map(ex => `
    <div>
      <div class="font-medium" style="font-size: 12pt;">${escapeHtml(ex.job_title)} — ${escapeHtml(ex.company_name)}</div>
      <div class="text-gray-600 text-[10pt]">${escapeHtml(ex.start_date || '')} – ${escapeHtml(ex.end_date || '')}</div>
      ${ex.description_bullets ? `<ul class="list-disc list-outside pl-5 mt-1" style="font-size: 11pt;">${ex.description_bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
    </div>
  `).join(""));

  const projectsHtml = sectionBlock("Relevant Projects", ranked.top_projects.map(pr => `
    <div>
      <div class="font-medium" style="font-size: 12pt;">${escapeHtml(pr.project_name)}</div>
      ${pr.description_bullets ? `<ul class="list-disc list-outside pl-5 mt-1" style="font-size: 11pt;">${pr.description_bullets.map(b => `<li>${escapeHtml(b)}</li>`).join('')}</ul>` : ""}
    </div>
  `).join(""));
  
  return `<div class="font-sans text-[12pt] leading-relaxed">${personalHtml}${workExHtml}${projectsHtml}${educationHtml}</div>`;
}