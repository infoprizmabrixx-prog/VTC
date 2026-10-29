# Vasavi Trading Company (VTC) In-House Portal — Project Rules & Tech Stack

## Mandatory Tech Stack
Any documentation, reference implementation, or flow written in another language/framework (e.g., Python/FastAPI/SQLite/Vanilla JS) **must** be understood and implemented strictly using the following stack:

### Frontend
- **React** + **TypeScript** + **Vite**
- **Tailwind CSS**
- **Framer Motion** (page transitions, hover effects, scroll animations)
- **GSAP** (premium hero animations)
- **Motion One** (where appropriate)
- **Lenis** (smooth scrolling)
- **React Router**
- **Axios** + **React Query (TanStack Query)**
- **Zustand** (global state management)
- **React Hook Form** + **Zod** validation
- **Lucide React Icons**
- **Recharts** (analytics)
- **React Hot Toast**
- **Swiper.js** (carousels)
- **React CountUp**

### Backend
- **Java 17** + **Spring Boot** (**Maven only** — do NOT use Gradle; Layered Architecture)
- **Spring Security** + **JWT Authentication** + **BCrypt** password hashing
- **Spring Data JPA** + **Hibernate**
- **REST APIs** + **OpenAPI (Swagger)**
- **Validation** (`jakarta.validation`)
- **Global Exception Handling** (`@RestControllerAdvice`)
- **Pagination, Filtering, and Sorting**
- **File Upload APIs**
- **Email Service**
- **Logging** (SLF4J / Logback)

### Database
- **MySQL**

## Installed Workspace Skills (`.agents/skills/`)
Use the corresponding specialized skills in `.agents/skills/` (from `rmyndharis/antigravity-skills`) when designing, implementing, or reviewing features:
- **Backend & Java:** `java-pro`, `backend-architect`, `backend-development-feature-development`, `backend-security-coder`, `auth-implementation-patterns`, `api-design-principles`, `openapi-spec-generation`, `architecture-patterns`
- **Database & MySQL:** `database-architect`, `sql-pro`, `sql-optimization-patterns`, `database-migrations-sql-migrations`
- **Frontend & UI/UX:** `frontend-developer`, `react-modernization`, `react-state-management`, `typescript-pro`, `typescript-advanced-types`, `tailwind-design-system`, `ui-ux-designer`, `frontend-security-coder`
- **Full-Stack & Testing:** `full-stack-orchestration-full-stack-feature`, `unit-testing-test-generate`, `e2e-testing-patterns`, `antigravity-skills-manager`
- **Code Efficiency & Conciseness:** `ponytail`, `ponytail-audit`, `ponytail-debt`, `ponytail-gain`, `ponytail-help`, `ponytail-review`, `caveman` (also configured in `.agents/rules/ponytail.md` and `.agents/rules/caveman.md`)

