"""The seed catalogue: courses, modules, quizzes, assignments, prices.

Kept out of seed.py so that seed.py stays a short, readable script and the
content lives on its own.

Module content is written to be SPOKEN. It goes straight into the Gemini Live
system instruction, so there is no markdown, no bullet points and no code
blocks — a tutor reading "const [count, setCount] = useState(0)" aloud sounds
like nonsense, so the prose says it the way a person would.

Prices are integer minor units (paise). One course is free, deliberately: it
keeps the no-payment path exercised, and it gives someone a real reason to
sign up before being asked for money.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from app.models.assignment import MatchMode

# (question, options, index of the correct option)
QuizSpec = tuple[str, list[str], int]
# (title, prompt, accepted answers, match mode)
AssignmentSpec = tuple[str, str, list[str], MatchMode]


@dataclass(frozen=True)
class ModuleSpec:
    title: str
    content: str
    quiz: list[QuizSpec] = field(default_factory=list)
    assignments: list[AssignmentSpec] = field(default_factory=list)


@dataclass(frozen=True)
class CourseSpec:
    title: str
    description: str
    price_minor: int
    exam_title: str
    modules: list[ModuleSpec]
    is_published: bool = True

    #: What the course used to cost, struck through beside the real price.
    #:
    #: None is the honest default and stays the default for anything without a
    #: genuine earlier price. These are DEV SEED figures for a script that
    #: refuses to run in production (see seed.py) — inventing a "was" price on a
    #: real course to make the current one read as a discount is a deceptive
    #: pricing practice, and migration 0016 deliberately left the column NULL
    #: for exactly that reason.
    list_price_minor: int | None = None

    #: How long a purchase lasts, in days. None asks
    #: `extensions.suggested_days` to size it from the module count, which is
    #: the same arithmetic the admin screen offers and migration 0016
    #: backfilled with — so a seeded course and an authored one agree.
    access_days: int | None = None

    @property
    def price_label(self) -> str:
        return "free" if self.price_minor == 0 else f"₹{self.price_minor // 100:,}"


JAVASCRIPT = CourseSpec(
    title="JavaScript Foundations",
    description=(
        "The language everything else here is built on. Values, functions, "
        "objects and asynchronous code, explained out loud."
    ),
    price_minor=0,  # free: the way in, and it keeps the no-payment path honest
    exam_title="JavaScript Foundations Certification",
    modules=[
        ModuleSpec(
            title="Values, types and variables",
            content="""
JavaScript has a small number of basic value types, and almost everything else
is built from them.

There are strings for text, numbers for arithmetic, booleans for true and
false, and two empty values: null, which means deliberately nothing, and
undefined, which means nothing has been set yet. That distinction matters. If
you ask an object for a property it does not have, you get undefined. If a
value is null, somebody put it there on purpose.

You declare variables with let when the value will change, and const when it
will not. Const does not make the value frozen. It means the name will keep
pointing at the same thing. You can still add items to a constant array,
because the array is the same array; you just cannot point that name at a
different array later.

Prefer const by default and reach for let only when you know something has to
change. It makes the code easier to read, because a reader can tell at a glance
which names will stay still.
""",
            quiz=[
                (
                    "What does `undefined` usually mean?",
                    [
                        "A value was deliberately emptied",
                        "No value has been set yet",
                        "The variable does not exist",
                        "A number failed to parse",
                    ],
                    1,
                ),
                (
                    "What does `const` actually guarantee?",
                    [
                        "The value can never change in any way",
                        "The name keeps pointing at the same value",
                        "The variable is available everywhere",
                        "The value is copied rather than shared",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Null or undefined",
                    "In one word, which value means 'nothing has been set yet' "
                    "rather than 'deliberately emptied'?",
                    ["undefined"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Functions and scope",
            content="""
A function is a reusable piece of behaviour. You give it inputs, called
parameters, and it gives back a result.

There are two shapes you will see constantly. The function keyword declares a
named function. The arrow form is shorter and is what most modern code uses for
small functions passed to other functions.

Scope is the rule about where a name is visible. A variable declared inside a
function is invisible outside it. That is a feature, not a limitation: it means
you can name something count inside one function without worrying about a count
somewhere else.

Functions can also see the variables of the place where they were written, even
after that place has finished running. That is called a closure, and it is the
idea behind most of the patterns you will meet later. A function remembers the
world it was born in.

The practical takeaway is that functions in JavaScript are values. You can pass
them to other functions, return them, and store them in variables, exactly like
a number or a string.
""",
            quiz=[
                (
                    "What is a closure?",
                    [
                        "A function that has finished running",
                        "A function that remembers the scope it was created in",
                        "A function with no parameters",
                        "A function stored on an object",
                    ],
                    1,
                ),
                (
                    "Why are functions called values in JavaScript?",
                    [
                        "They always return a value",
                        "They can be passed, returned and stored like any value",
                        "They are stored as strings internally",
                        "They must be assigned to a variable",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Name the idea",
                    "A function that remembers the variables from where it was "
                    "written, even after that code has finished, is called a "
                    "what? One word.",
                    ["closure", "a closure"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Arrays and objects",
            content="""
Arrays hold ordered lists. Objects hold labelled values.

For arrays, three methods do most of the work. Map takes every item and returns
a new array of transformed items. Filter returns a new array containing only
the items that pass a test. Reduce walks the list and builds up a single result.
Notice that map and filter both return new arrays. They do not change the
original. That habit of producing new values instead of editing old ones will
matter enormously when you get to React.

Objects group related values under names. You read a property with a dot,
and if the property might not exist, optional chaining lets you ask safely
without crashing.

Destructuring is the shorthand you will see everywhere. Instead of pulling
properties out one line at a time, you name the ones you want on the left of the
assignment and get them all at once. It works for arrays too, by position
rather than by name.
""",
            quiz=[
                (
                    "What does `map` return?",
                    [
                        "The original array, modified",
                        "A new array of transformed items",
                        "A single combined value",
                        "Only the items that pass a test",
                    ],
                    1,
                ),
                (
                    "Which method reduces a list to one value?",
                    ["map", "filter", "reduce", "forEach"],
                    2,
                ),
            ],
            assignments=[
                (
                    "Choosing the method",
                    "You have a list of prices and want only the ones under a "
                    "hundred. Which array method do you use? One word.",
                    ["filter"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Asynchronous JavaScript",
            content="""
JavaScript runs on a single thread, which means it can only do one thing at a
time. Anything slow, like fetching data over the network, cannot be allowed to
block that thread or the whole page would freeze.

The answer is the promise. A promise is an object representing a value that is
not ready yet. It is either pending, fulfilled with a value, or rejected with an
error.

You could handle a promise with then and catch, but async and await read far
better. Marking a function async lets you use await inside it, and awaiting a
promise pauses that function, not the whole program, until the value arrives.
Everything else keeps running.

Errors work the way you would hope: wrap the await in a try and catch block, and
a rejected promise lands in catch just like a thrown error.

The mental model to hold onto is that await does not make code synchronous. It
makes asynchronous code readable in the order it happens.
""",
            quiz=[
                (
                    "What are the three states of a promise?",
                    [
                        "Started, running, finished",
                        "Pending, fulfilled, rejected",
                        "Open, closed, failed",
                        "Waiting, resolved, cancelled",
                    ],
                    1,
                ),
                (
                    "What does `await` pause?",
                    [
                        "The entire program",
                        "Only the async function it appears in",
                        "The browser's rendering",
                        "Nothing, it is only a hint",
                    ],
                    1,
                ),
                (
                    "How do you catch a rejected promise when using await?",
                    [
                        "With a try and catch block",
                        "With an if statement on the result",
                        "You cannot; use then and catch instead",
                        "By checking the promise state property",
                    ],
                    0,
                ),
            ],
            assignments=[
                (
                    "Explain await",
                    "In two or three sentences, explain what await does. Your "
                    "answer must mention a promise and must mention pausing.",
                    ["promise", "paus"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
    ],
)


REACT = CourseSpec(
    title="React Essentials",
    description=(
        "Components, props, state and effects. The four ideas that account "
        "for most of the React you will ever write."
    ),
    price_minor=149_900,  # ₹1,499
    list_price_minor=199_900,
    exam_title="React Essentials Certification",
    modules=[
        ModuleSpec(
            title="What React actually does",
            content="""
React is a library for building user interfaces out of components.

A component is a function that returns a description of what should appear on
screen. You do not write instructions to change the page step by step. Instead
you describe what the page should look like for a given set of data, and React
works out which parts of the real page need to change.

This is the central idea, and it is what people mean when they call React
declarative. You declare the result you want. React handles getting there.

When the data changes, React calls your component function again and compares
the new description against the previous one. Only the differences are applied
to the actual page. That comparison is why you can re-render freely without the
page flickering or losing what the user had focused.
""",
            quiz=[
                (
                    "What does a React component return?",
                    [
                        "A description of what should appear on screen",
                        "A direct instruction to modify the page",
                        "A copy of the whole page",
                        "A list of event handlers",
                    ],
                    0,
                ),
                (
                    "Why is React described as declarative?",
                    [
                        "Because it declares variables for you",
                        "Because you describe the result, not the steps",
                        "Because components must be declared before use",
                        "Because it uses declaration files",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Name the idea",
                    "In one word, what do we call the style of programming "
                    "where you describe the result you want rather than the "
                    "steps to get there?",
                    ["declarative"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Props: passing data in",
            content="""
Props are how a parent component passes data down to a child.

You write them like attributes. If you render a Greeting component and give it
a name attribute, the Greeting function receives an object with a name key on
it. That object is conventionally called props.

The important rule is that props are read only. A component must never modify
the props it receives. Data flows in one direction, from parent down to child,
and that one way flow is what makes a React application possible to reason
about. If a value on screen is wrong, you can walk upward and find exactly one
place it came from.

If a child needs to change something, the parent passes down a function for the
child to call. The child reports what happened. The parent decides what to do
about it.
""",
            quiz=[
                (
                    "Can a component modify its own props?",
                    [
                        "Yes, freely",
                        "No, props are read only",
                        "Only inside an effect",
                        "Only if they are objects",
                    ],
                    1,
                ),
                (
                    "How does a child tell its parent something happened?",
                    [
                        "By editing the props directly",
                        "By calling a function the parent passed down",
                        "By writing to a global variable",
                        "It cannot",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Explain one-way data flow",
                    "In two or three sentences, explain how a child component "
                    "tells its parent that something happened. Mention what "
                    "props are, and what the parent passes down.",
                    ["props", "function"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="State with useState",
            content="""
State is data that belongs to a component and changes over time.

Calling useState with an initial value gives you back two things: the current
value, and a function to update it. People usually destructure them into a pair
of names, one for the value and one for the setter.

Calling the setter tells React the component needs to re-render. React then
calls your component function again, and this time useState hands back the new
value instead of the initial one.

The initial value is only used on the very first render. On later renders React
ignores it and returns whatever the current state is.

State updates are not applied instantly. If you need the previous value to work
out the next one, pass a function to the setter instead of a plain value. That
is the reliable way to do it when several updates happen close together.
""",
            quiz=[
                (
                    "What does useState return?",
                    [
                        "Just the current value",
                        "The current value and a setter function",
                        "A setter function only",
                        "An object with a value property",
                    ],
                    1,
                ),
                (
                    "When is the initial value used?",
                    [
                        "On every render",
                        "Only on the first render",
                        "Whenever the setter is called",
                        "Only when the component unmounts",
                    ],
                    1,
                ),
                (
                    "How do you safely use the previous value in an update?",
                    [
                        "Read the state variable directly",
                        "Pass a function to the setter",
                        "Call the setter twice",
                        "Use a plain variable instead",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "The state setter",
                    "Which hook do you call to add state to a function "
                    "component? Answer with the hook name only.",
                    ["useState", "the useState hook"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Effects and when you need them",
            content="""
An effect is for synchronising your component with something outside React.
Fetching data, subscribing to a socket, setting a timer, or reading from the
browser directly.

You call useEffect with a function and a list of dependencies. React runs the
function after rendering, and runs it again whenever one of the dependencies
has changed since last time.

If your effect sets up something ongoing, return a cleanup function. React
calls it before running the effect again and when the component is removed.
Forgetting cleanup is how you end up with timers that never stop and listeners
that pile up.

The most common mistake is reaching for an effect when you do not need one. If
a value can be worked out from existing props or state, just calculate it while
rendering. An effect that only exists to copy one piece of state into another
adds a render and a chance to get out of step, and buys you nothing.
""",
            quiz=[
                (
                    "What is an effect for?",
                    [
                        "Calculating values from props",
                        "Synchronising with something outside React",
                        "Declaring state",
                        "Rendering child components",
                    ],
                    1,
                ),
                (
                    "What does the cleanup function do?",
                    [
                        "Deletes the component",
                        "Runs before the next effect and on unmount",
                        "Resets state to its initial value",
                        "Cancels the current render",
                    ],
                    1,
                ),
                (
                    "Do you need an effect to transform props for display?",
                    [
                        "Yes, always",
                        "No, calculate it while rendering",
                        "Only when the value is a string",
                        "Only in production builds",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "When not to use an effect",
                    "Describe in your own words what you should do instead of "
                    "an effect when a value can be worked out from existing "
                    "props or state. Mention rendering and calculating.",
                    ["render", "calculat"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
    ],
)


TYPESCRIPT = CourseSpec(
    title="TypeScript for JavaScript Developers",
    description=(
        "Types that catch mistakes before they run, without getting in your "
        "way. For people who already write JavaScript."
    ),
    price_minor=179_900,  # ₹1,799
    list_price_minor=249_900,
    exam_title="TypeScript Certification",
    modules=[
        ModuleSpec(
            title="Why types, and how they are checked",
            content="""
TypeScript is JavaScript with a type checker on top. It does not run in the
browser. It checks your code and then hands plain JavaScript to whatever runs
it.

That is worth sitting with, because it explains most of TypeScript's
behaviour. Types exist at the moment you write and build the code. They are
gone by the time it runs. So a type cannot protect you from data arriving from
a network request in a shape you did not expect. It only protects you from your
own code contradicting itself.

You often do not have to write types at all. TypeScript infers them. If you
assign a string to a variable, it knows the variable is a string, and it will
complain if you later try to call a number method on it.

Write types where they add information the compiler cannot work out on its own:
function parameters, and the shape of data crossing a boundary.
""",
            quiz=[
                (
                    "When does TypeScript check types?",
                    [
                        "While the program runs",
                        "Before it runs, at build time",
                        "Only in production",
                        "Continuously, in the browser",
                    ],
                    1,
                ),
                (
                    "Can types validate data from a network response?",
                    [
                        "Yes, automatically",
                        "No, types are gone by the time it runs",
                        "Only for JSON",
                        "Only with strict mode",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Where types live",
                    "Do TypeScript types exist while the program is running? "
                    "Answer yes or no.",
                    ["no"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Interfaces, types and unions",
            content="""
There are two ways to name the shape of an object: an interface, and a type
alias. For describing object shapes they are close to interchangeable. Pick one
and be consistent.

The feature that changes how you write code is the union. A union says a value
is one of several possibilities. A status might be loading, or ready, or
failed, and nothing else. Now the compiler knows every case, and it can tell
you when you have forgotten one.

This pairs with narrowing. When you check which case you are in, with a plain
if statement, TypeScript follows along and treats the value as that specific
case inside the branch. You do not need casts. You just need checks.

Modelling state as a union rather than several loose booleans removes whole
categories of bug. You cannot be loading and failed at the same time if the
type does not allow it.
""",
            quiz=[
                (
                    "What does a union type express?",
                    [
                        "A value combining several types at once",
                        "A value that is one of several possibilities",
                        "An object merged from two interfaces",
                        "An array of mixed values",
                    ],
                    1,
                ),
                (
                    "What is narrowing?",
                    [
                        "Reducing a file's size",
                        "The compiler following your checks to a specific case",
                        "Casting a value to a smaller type",
                        "Removing unused properties",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Modelling state",
                    "Explain in a sentence or two why modelling a request as a "
                    "union of loading, ready and failed is safer than three "
                    "separate booleans. Mention impossible or cannot.",
                    ["union"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Generics without the fear",
            content="""
A generic is a type with a hole in it, filled in at the point of use.

Think about a function that takes an array and returns its first item. Without
generics you would either write one version per type, or accept anything and
lose all information about what comes back. A generic lets you say: whatever
type goes in, the same type comes out.

The angle bracket syntax puts people off, but the idea is ordinary. The letter
in the brackets is just a parameter, like a function parameter, except it holds
a type instead of a value.

You will meet generics long before you write them. Arrays are generic. Promises
are generic. A promise of a string is a different type from a promise of a
number, and that is what lets await give you back something useful.

Reach for a generic when a function's output type depends on its input type.
""",
            quiz=[
                (
                    "What is a generic?",
                    [
                        "A type that accepts anything",
                        "A type parameter filled in at the point of use",
                        "A function with optional arguments",
                        "A shortcut for a union",
                    ],
                    1,
                ),
                (
                    "When should you reach for a generic?",
                    [
                        "Whenever a function has parameters",
                        "When the output type depends on the input type",
                        "Only inside classes",
                        "When you want to disable checking",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Generic or any",
                    "If a function should return the same type it was given, "
                    "do you use a generic or any? One word.",
                    ["generic", "a generic"],
                    MatchMode.EXACT,
                ),
            ],
        ),
    ],
)


NODE = CourseSpec(
    title="Node.js and Express",
    description=(
        "Server-side JavaScript: the event loop, modules, and building an "
        "HTTP API you can reason about."
    ),
    price_minor=199_900,  # ₹1,999
    list_price_minor=279_900,
    exam_title="Node.js Certification",
    modules=[
        ModuleSpec(
            title="The event loop, and why Node is fast",
            content="""
Node runs JavaScript outside the browser, on a single thread, using the same
event loop model you met in the language itself.

Here is the part that surprises people. One thread sounds slow, but most of
what a server does is wait. Waiting for a database. Waiting for a file. Waiting
for another service. Node hands that waiting to the operating system and gets
on with other requests. The thread is only busy when there is actual JavaScript
to run.

That is why Node is excellent at handling many connections that are mostly
idle, and poor at heavy computation. A long, purely computational loop blocks
the one thread, and every other request waits behind it.

The practical rule follows directly. Never do slow synchronous work in a
request handler. Use the asynchronous version of an API when one exists, and
move genuinely heavy computation to a worker or a separate service.
""",
            quiz=[
                (
                    "Why can a single thread handle many connections?",
                    [
                        "Because requests are processed in parallel",
                        "Because most of the work is waiting, which is handed off",
                        "Because Node creates a thread per request",
                        "Because JavaScript is compiled",
                    ],
                    1,
                ),
                (
                    "What kind of work is worst for Node?",
                    [
                        "Many idle connections",
                        "Long synchronous computation",
                        "Reading files asynchronously",
                        "Serving static assets",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "The blocking problem",
                    "Explain in a sentence or two why a long synchronous loop "
                    "in a request handler hurts every other request. Mention "
                    "thread and block.",
                    ["thread", "block"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Modules, packages and dependencies",
            content="""
Node code is organised into modules. Each file is a module, and it chooses what
to share with the rest of the program by exporting it.

There are two systems in the wild. CommonJS uses require and module exports,
and is what older Node code uses. ES modules use import and export, and are the
standard going forward. You will meet both. A project picks one, usually
through the type field in its package file.

Packages come from the registry and are recorded in package dot json. Two
details matter more than people expect. The lock file records the exact
versions actually installed, so that everyone on the team, and the production
build, get identical code. And dependencies are split into the ones the running
application needs and the ones only needed to build and test it.

Every dependency is code you are choosing to trust and to keep updated. Adding
one to save four lines is rarely a good trade.
""",
            quiz=[
                (
                    "What does the lock file guarantee?",
                    [
                        "The newest versions are always used",
                        "Everyone installs identical versions",
                        "Packages cannot be removed",
                        "Dependencies are audited for security",
                    ],
                    1,
                ),
                (
                    "Which is the modern module system?",
                    [
                        "CommonJS with require",
                        "ES modules with import and export",
                        "AMD",
                        "Global scripts",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Why lock",
                    "In one sentence, why does a lock file matter? Mention "
                    "version and same or identical.",
                    ["version"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Building an HTTP API with Express",
            content="""
Express is a thin layer over Node's built-in HTTP server. It gives you routing
and middleware, and stays out of the way otherwise.

A route says: for this method and this path, run this handler. The handler
receives a request and a response, and its job is to send something back.

Middleware is the idea that makes Express worth using. A middleware function
sits in the chain before your handler and can inspect or change the request,
or stop it entirely. Parsing a JSON body, checking authentication, logging,
adding CORS headers: all middleware. Order matters, because they run in the
order you register them.

Error handling has its own shape: a middleware that takes an error as its first
argument. Register it last, and anything that fails ends up there, so you have
one place that decides what a client is told when something goes wrong.

Send status codes that mean something. Two hundred for success, four hundred
and one when the caller is not signed in, four hundred and three when they are
but may not do this, four hundred and four when it does not exist.
""",
            quiz=[
                (
                    "What is middleware?",
                    [
                        "A database layer",
                        "A function in the chain before the handler",
                        "A template engine",
                        "A type of route",
                    ],
                    1,
                ),
                (
                    "Which status code means 'signed in, but not allowed'?",
                    ["400", "401", "403", "404"],
                    2,
                ),
                (
                    "Where should the error-handling middleware be registered?",
                    [
                        "First, before all routes",
                        "Last, after the routes",
                        "Inside each handler",
                        "It does not matter",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Pick the status",
                    "A signed-in student requests an admin-only page. Which "
                    "HTTP status code should they get? Numbers only.",
                    ["403"],
                    MatchMode.EXACT,
                ),
            ],
        ),
    ],
)


NEXTJS = CourseSpec(
    title="Next.js App Router",
    description=(
        "Server and client components, routing, data fetching and rendering. "
        "The modern Next.js model, explained plainly."
    ),
    price_minor=249_900,  # ₹2,499
    list_price_minor=349_900,
    exam_title="Next.js Certification",
    modules=[
        ModuleSpec(
            title="Routing by folders",
            content="""
In the App Router, your folder structure is your routing table. A folder inside
the app directory becomes a URL segment, and a file named page inside it makes
that segment a real, visitable route.

A few filenames have special meaning. Layout wraps everything below it and does
not re-render when you navigate between its children, which is what keeps a
sidebar or a header steady as the content changes. Loading gives you an instant
skeleton while a page is still fetching. Error catches a failure in that part
of the tree without taking down the whole application.

Square brackets in a folder name make it dynamic, so a folder named with
brackets around courseId matches any value there and hands it to your page.

Round brackets make a route group. It organises files without adding anything
to the URL, which is how you can have one set of pages sharing a marketing
layout and another sharing a dashboard layout, without either appearing in the
address.
""",
            quiz=[
                (
                    "What makes a folder a visitable route?",
                    [
                        "Any file inside it",
                        "A file named page",
                        "A file named route",
                        "Adding it to a config file",
                    ],
                    1,
                ),
                (
                    "What do round brackets around a folder name do?",
                    [
                        "Make the route dynamic",
                        "Group routes without affecting the URL",
                        "Mark the folder as private",
                        "Create an API endpoint",
                    ],
                    1,
                ),
                (
                    "Why put a sidebar in a layout rather than a page?",
                    [
                        "Layouts load faster",
                        "It does not re-render when children change",
                        "Pages cannot contain components",
                        "It is required by the router",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Name the file",
                    "Which filename turns a folder into a visitable route? "
                    "The name only, without the extension.",
                    ["page"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Server and client components",
            content="""
This is the idea that everything else in modern Next.js depends on.

By default, every component is a server component. It runs on the server only.
It can read a database or use a secret key directly, because none of its code
is sent to the browser. What the browser receives is the resulting markup.

A client component is one you opt into, by putting the use client directive at
the top of the file. Its code is sent to the browser, and it can do the things
that need a browser: state, effects, event handlers, and anything touching the
window.

The rule of thumb is to keep components on the server unless they need
interactivity, and to push the use client boundary as far down the tree as you
can. A page that is mostly static with one interactive button should not be
entirely a client component because of that button.

The mistake to avoid is putting a secret in a component that turns out to be a
client component. If it ships to the browser, it is public.
""",
            quiz=[
                (
                    "What does the `use client` directive do?",
                    [
                        "Sends that component's code to the browser",
                        "Makes the component render faster",
                        "Disables server rendering entirely",
                        "Marks the file as a route",
                    ],
                    0,
                ),
                (
                    "Which components can safely hold a secret key?",
                    [
                        "Client components",
                        "Server components",
                        "Both",
                        "Neither",
                    ],
                    1,
                ),
                (
                    "Where should the client boundary go?",
                    [
                        "At the top of the tree",
                        "As far down as possible",
                        "In the layout",
                        "It makes no difference",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Secrets and boundaries",
                    "Explain in a sentence or two why an API key must not be "
                    "used in a client component. Mention browser and public or "
                    "visible.",
                    ["browser"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Fetching and caching data",
            content="""
In a server component you fetch data by awaiting it directly in the component.
There is no effect, no loading state, no separate data hook. The component is
async, and it waits.

Next extends fetch with caching. By default a request may be cached and reused.
You control that per request: you can ask for fresh data every time, or say
that a cached response may be reused for a number of seconds before it is
fetched again.

Choosing between them is a product decision, not a technical one. A marketing
page listing courses can be a minute stale without anyone caring. A student's
own progress must never be. The rule is to cache what is shared and public, and
never cache what is specific to one signed-in person.

When data must be fresh per request, say so explicitly rather than relying on a
default, because defaults change between versions and a silently cached private
page is a serious bug.
""",
            quiz=[
                (
                    "How do you fetch data in a server component?",
                    [
                        "With an effect",
                        "By awaiting it directly in the component",
                        "With a data-fetching hook",
                        "Through an API route only",
                    ],
                    1,
                ),
                (
                    "Which data should never be cached?",
                    [
                        "A public course listing",
                        "Data specific to one signed-in user",
                        "Static images",
                        "The site's footer",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "What to cache",
                    "Should a signed-in student's own progress page be cached "
                    "and shared? Answer yes or no.",
                    ["no"],
                    MatchMode.EXACT,
                ),
            ],
        ),
    ],
)


CLOUD = CourseSpec(
    title="Cloud Computing Foundations",
    description=(
        "What the cloud actually is, the service models, and the ideas behind "
        "deploying and running something that stays up."
    ),
    price_minor=299_900,  # ₹2,999
    list_price_minor=399_900,
    exam_title="Cloud Computing Certification",
    modules=[
        ModuleSpec(
            title="What the cloud is, and the service models",
            content="""
The cloud is someone else's computers, rented by the hour, with an API in front
of them. Everything else is a consequence of that.

Services are usually sorted into three models. Infrastructure as a service
gives you the raw machine: you get an operating system and you are responsible
for everything above it. Platform as a service gives you somewhere to put your
code and handles the machine for you. Software as a service is the finished
application, where you are just a user.

The trade is always the same. The more the provider manages, the less control
you have and the less work you do. There is no correct answer, only a choice
about where you want to spend your attention.

The other consequence of renting by the hour is elasticity. You can have ten
machines during the day and one at night, and pay accordingly. That is the real
change from owning hardware: capacity becomes a dial rather than a purchase.
""",
            quiz=[
                (
                    "In infrastructure as a service, who patches the operating system?",
                    ["The provider", "You", "Nobody", "It is automatic"],
                    1,
                ),
                (
                    "What is the trade-off as you move up the service models?",
                    [
                        "More control, more work",
                        "Less control, less work",
                        "Lower cost, lower reliability",
                        "There is no trade-off",
                    ],
                    1,
                ),
                (
                    "What does elasticity mean?",
                    [
                        "Data is replicated across regions",
                        "Capacity can grow and shrink with demand",
                        "Services never go down",
                        "Storage is unlimited",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Name the model",
                    "You want to push code and never think about the operating "
                    "system underneath. Which service model is that? Give the "
                    "three-letter abbreviation.",
                    ["PaaS", "paas"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Compute, storage and networking",
            content="""
Three building blocks show up under every cloud product, whatever it is called.

Compute is anything that runs your code. A virtual machine you manage, a
container the platform schedules for you, or a function that exists only for
the milliseconds it is handling a request. Cost and control move together
again: the smaller the unit, the less you manage and the less idle time you pay
for.

Storage comes in two useful shapes. Object storage holds whole files, addressed
by a key, and is cheap and effectively endless. Block storage behaves like a
disk attached to a machine. Databases sit on top of one of these and add
structure and guarantees.

Networking is what decides who can reach what. A private network keeps your
database unreachable from the internet, so the only way in is through your
application. A load balancer spreads traffic across several instances and stops
sending it to one that has stopped answering.

Default to private. Anything reachable from the internet should be there
because you decided it should be.
""",
            quiz=[
                (
                    "Which storage type is best for user-uploaded files?",
                    ["Block storage", "Object storage", "A cache", "A queue"],
                    1,
                ),
                (
                    "What should a database's network exposure be?",
                    [
                        "Public, for convenience",
                        "Private, reachable only from the application",
                        "Public but password protected",
                        "It does not matter",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Network defaults",
                    "Should a production database be reachable directly from "
                    "the public internet? Answer yes or no.",
                    ["no"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Deploying, scaling and staying up",
            content="""
Getting code onto a server is the easy part. Keeping it running while you keep
changing it is the job.

Scaling comes in two directions. Vertical means a bigger machine, which is
simple and has a ceiling. Horizontal means more machines, which has no real
ceiling but forces a discipline on you: your application must not keep
important state in its own memory, because the next request may land on a
different instance.

Deploying without downtime follows from that. Start new instances, check they
are healthy, move traffic across, then retire the old ones. A health check that
actually tests the thing that matters, like whether the database is reachable,
is what makes this safe. A health check that only proves the process is alive
will happily route traffic to something broken.

And you cannot operate what you cannot see. Logs tell you what happened,
metrics tell you how much and how often, and alerts tell you when to look. If
an incident is discovered by a customer email, that is a monitoring gap, not
bad luck.
""",
            quiz=[
                (
                    "What must you avoid when scaling horizontally?",
                    [
                        "Using a load balancer",
                        "Keeping important state in one instance's memory",
                        "Running more than one process",
                        "Using a database",
                    ],
                    1,
                ),
                (
                    "What makes a health check useful?",
                    [
                        "It returns quickly",
                        "It tests the dependencies that matter",
                        "It always returns success",
                        "It runs once at startup",
                    ],
                    1,
                ),
                (
                    "Vertical scaling means:",
                    [
                        "More machines",
                        "A bigger machine",
                        "More regions",
                        "More database replicas",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Scaling out",
                    "Explain in a sentence or two why an application that "
                    "stores session data in its own memory breaks when you run "
                    "several instances. Mention instance and state or memory.",
                    ["instance"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
    ],
)


# ---------------------------------------------------------------------------
# The rest of the stack.
#
# The six courses above are all JavaScript-shaped, which meant a "full stack"
# bundle could only ever be half a stack: no database course, no server
# language other than Node, and nothing for somebody whose employer runs Java
# or PHP. These five fill that in, and they are what makes the stack bundles in
# seed.py real rather than a repackaging of the same four courses.
# ---------------------------------------------------------------------------


HTML_CSS = CourseSpec(
    title="HTML and CSS Foundations",
    description=(
        "The two languages every web page is made of. Structure, styling, "
        "layout and accessible responsive design, explained out loud."
    ),
    price_minor=99_900,  # ₹999
    list_price_minor=149_900,
    exam_title="HTML and CSS Certification",
    modules=[
        ModuleSpec(
            title="How a page is structured",
            content="""
HTML describes what things are, not what they look like. That single idea is
most of what separates markup that ages well from markup that does not.

A heading is a heading because it introduces a section, not because you wanted
larger text. A list is a list because the items belong together. A button is a
button because clicking it does something. If you reach for a div and then
spend three lines making it behave like a button, the right answer was almost
always a button.

This matters for real reasons rather than tidiness. A screen reader announces
headings, so somebody can jump through a page the way a sighted reader skims
it. A search engine reads the same structure. Keyboard navigation follows the
order of your elements. All of that comes free when the markup says what it
means, and all of it has to be rebuilt by hand when it does not.

The skeleton of every page is the same. A doctype declaring this is HTML, an
html element wrapping everything, a head holding the title and the links to
stylesheets, and a body holding everything a visitor actually sees. Nothing in
the head is rendered; everything in the body is.

One habit worth forming early. Before you write markup for a section, say out
loud what the section is. A navigation bar. An article. A list of three prices.
The words you use are usually the elements you want.
""",
            quiz=[
                (
                    "Why choose a heading element rather than styling a div?",
                    [
                        "It renders faster",
                        "It tells assistive tools and search engines what the text is",
                        "It uses less memory",
                        "It is required by the doctype",
                    ],
                    1,
                ),
                (
                    "What goes in the head of a document?",
                    [
                        "Everything the visitor sees",
                        "Title, stylesheet links and metadata",
                        "The navigation bar",
                        "The first heading",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Naming the part",
                    "You are marking up a bar of links across the top of the "
                    "page. Which HTML element describes it? One word.",
                    ["nav"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Selectors, the cascade and specificity",
            content="""
CSS is a list of rules. Each rule picks some elements and sets some properties
on them. The whole language is that, plus the question of what happens when two
rules disagree.

You pick elements with selectors. By element name, which is broad. By class,
which is what you will use most of the time. By id, which is narrow and, in
practice, a trap: an id beats almost everything else, so a page styled with ids
becomes a page you can only change by adding more ids.

When two rules set the same property on the same element, three things decide
the winner, in order. Importance, which you should almost never use. Then
specificity, which counts how narrowly the selector points: an id counts more
than a class, and a class counts more than an element name. Then source order,
where the later rule wins.

The practical advice that falls out of this is simple. Keep your selectors flat
and roughly equal in specificity, usually a single class. Then the cascade
reduces to source order, which is something you can see by reading the file
from top to bottom. Most CSS that people describe as unpredictable is CSS where
specificity is doing the deciding and nobody can tell by looking.

Inheritance is separate, and often confused with the cascade. Some properties,
mostly to do with text, pass down to children automatically. Colour and font
family inherit. Borders and padding do not.
""",
            quiz=[
                (
                    "Two rules set the same property. What is checked first?",
                    [
                        "Source order",
                        "Importance, then specificity, then source order",
                        "File size",
                        "Which stylesheet loaded first",
                    ],
                    1,
                ),
                (
                    "Why are ids discouraged as styling hooks?",
                    [
                        "They are slower",
                        "Their high specificity is hard to override later",
                        "They cannot be combined with classes",
                        "They are deprecated",
                    ],
                    1,
                ),
                (
                    "Which of these inherits from a parent element?",
                    ["Border", "Padding", "Font family", "Margin"],
                    2,
                ),
            ],
            assignments=[
                (
                    "The safe hook",
                    "Which selector type should most of your styling use, so "
                    "specificity stays flat? One word.",
                    ["class"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Layout with flexbox and grid",
            content="""
For years, layout was done with tools built for something else, and it showed.
Modern CSS has two layout systems designed for the job, and knowing which to
reach for saves most of the pain.

Flexbox lays things out along one axis. A row of navigation links. A card with
a body that grows and a footer pinned to the bottom. A toolbar where one item
pushes the rest to the right. You set display to flex on the parent, choose the
direction, and then decide how the free space is shared out along that axis and
how items line up across it.

Grid lays things out in two axes at once. You describe the columns and rows on
the container and place items into them. A page with a sidebar and a main area.
A gallery of cards that reflows. A form with labels in one column and inputs in
another. Grid is the right answer whenever you find yourself nesting flex
containers to fake a table.

The rule of thumb is this. If you can describe the layout as a line, use
flexbox. If you have to describe it as a shape, use grid. They compose freely,
and a grid cell containing a flex row is completely ordinary.

Responsive design then comes almost free. Both systems already wrap and reflow;
a media query changes the number of grid columns, or flips a flex direction
from row to column, at a chosen width. Design for the small screen first and
add columns as the space appears, rather than designing wide and then trying to
cram it down.
""",
            quiz=[
                (
                    "When is grid the better choice than flexbox?",
                    [
                        "For anything with more than three items",
                        "When the layout needs rows and columns at once",
                        "When you need animation",
                        "When the page must work without JavaScript",
                    ],
                    1,
                ),
                (
                    "What is the recommended starting point for responsive work?",
                    [
                        "Design for the widest screen, then shrink it",
                        "Design for the small screen, then add columns",
                        "Use fixed pixel widths everywhere",
                        "Build a separate mobile site",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "One axis or two",
                    "You need a sidebar beside a main area, with a header "
                    "across both. Which layout system fits? One word.",
                    ["grid"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Accessible, responsive pages",
            content="""
An accessible page is not a special version of a page. It is the ordinary page,
built so that it still works when somebody cannot see it, cannot use a mouse,
or has turned the text size up.

Four habits cover most of it. Every image that carries meaning gets alternative
text describing what it shows, and an image that is pure decoration gets empty
alternative text so it is skipped rather than announced. Every form field gets
a real label tied to it, not placeholder text that vanishes the moment somebody
types. Every interactive thing is reachable with the keyboard and shows a
visible focus ring when it is. And colour is never the only signal, because a
red border on its own says nothing to somebody who cannot distinguish it.

Contrast is the one people measure least and get wrong most. Ordinary body text
needs a contrast ratio of at least four and a half to one against its
background. Large text and meaningful graphics need three to one. These are not
opinions; they are numbers you can check, and pale grey text on a white card is
the usual offender.

Responsiveness and accessibility overlap more than people expect. A layout that
survives a narrow window usually survives a visitor who has zoomed to two
hundred per cent, because both are the same problem: less room. Use relative
units for type and spacing so the page scales with the reader's settings rather
than fighting them.

Finally, respect the reader's stated preferences. If somebody has asked their
system to reduce motion, honour it and drop the animation. It is one media
query, and for some people it is the difference between using the page and
feeling ill.
""",
            quiz=[
                (
                    "What contrast ratio does ordinary body text need?",
                    ["2 to 1", "3 to 1", "4.5 to 1", "7 to 1"],
                    2,
                ),
                (
                    "Why is placeholder text a poor substitute for a label?",
                    [
                        "It cannot be styled",
                        "It disappears as soon as somebody types",
                        "It is unsupported in older browsers",
                        "It breaks form submission",
                    ],
                    1,
                ),
                (
                    "A decorative image should have:",
                    [
                        "A detailed description",
                        "Empty alternative text so it is skipped",
                        "No alt attribute at all",
                        "The filename as its alt text",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Contrast floor",
                    "State the minimum contrast ratio for normal body text, "
                    "written as a ratio.",
                    ["4.5:1", "4.5 to 1", "4.5"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
    ],
)


POSTGRESQL = CourseSpec(
    title="PostgreSQL and SQL",
    description=(
        "The database under almost every stack here. Tables, queries, joins, "
        "indexes and transactions, explained out loud."
    ),
    price_minor=199_900,  # ₹1,999
    list_price_minor=279_900,
    exam_title="PostgreSQL Certification",
    modules=[
        ModuleSpec(
            title="Tables, types and keys",
            content="""
A relational database stores facts in tables. A table has columns, each with a
type, and rows, each one fact of that shape. Almost everything else in SQL
follows from taking that seriously.

Choosing types is the first real design decision, and it is not a formality.
Text for text. Integer for whole numbers. Timestamp with time zone for a moment
in time, always with the zone, because a timestamp without one is a number
whose meaning depends on where the reader is standing. Boolean for true and
false. And for money, an integer count of the smallest unit, or a numeric type
with a fixed scale, never a floating point number. Floating point cannot
represent one tenth exactly, and billing is the last place that should be
approximate.

Every table wants a primary key: one column, or a small set of them, that
uniquely names a row. Databases will happily give you an auto-incrementing
integer, and that is fine inside one system. A universally unique identifier is
better when rows are created in more than one place, or when an id ends up in a
URL and you would rather not tell the world how many customers you have.

A foreign key says a value in this table must match a row over there. It is the
database refusing to hold nonsense. Deleting the referenced row can cascade,
which deletes the children too, or restrict, which refuses. That choice is a
real decision about the business, not a default to accept blindly. An order that
points at a deleted course is a receipt for something that no longer exists.

Finally, not null. Most columns should be not null, and a nullable column
should be nullable because absent is a genuine state, not because you have not
decided yet.
""",
            quiz=[
                (
                    "Why should money never be stored as a floating point number?",
                    [
                        "Floats are slower",
                        "Floats cannot represent decimal fractions exactly",
                        "Floats take more space",
                        "Floats cannot be indexed",
                    ],
                    1,
                ),
                (
                    "What does a foreign key give you?",
                    [
                        "A faster query",
                        "A guarantee that the referenced row exists",
                        "Automatic sorting",
                        "A backup of the parent row",
                    ],
                    1,
                ),
                (
                    "A timestamp column should normally:",
                    [
                        "Store local time only",
                        "Include the time zone",
                        "Be stored as text",
                        "Be stored as an integer",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "The right money type",
                    "Name the type you should NOT use for a price column. One "
                    "word.",
                    ["float"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Selecting, filtering and grouping",
            content="""
A query says which rows you want, which columns you want from them, and in what
order. Learn to read it in that order rather than the order it is written and
most of SQL stops feeling backwards.

The from clause names where the rows come from. The where clause throws rows
away, one at a time, before anything else happens. The group by clause collapses
what survives into buckets. The having clause throws away whole buckets. The
select clause chooses what to show. And order by, last, decides the sequence.

The difference between where and having catches everybody once. Where filters
individual rows, so it cannot talk about a count, because at that point nothing
has been counted. Having filters groups, so it can. If you want the courses with
more than three modules, the count belongs in having.

Aggregates are the functions that collapse many rows into one. Count, sum,
average, minimum, maximum. Anything in the select list that is not aggregated
has to appear in the group by, and if that rule feels arbitrary, ask yourself
which of the twelve titles in a bucket the database was supposed to pick.

Two habits will save you repeatedly. Never write select star in code that has to
keep working, because the day somebody adds a column your query starts carrying
it. And be careful with null in comparisons: null is not equal to anything,
including itself, so testing whether a column equals null never matches. The
question you meant is whether the column is null.
""",
            quiz=[
                (
                    "Which clause filters whole groups rather than rows?",
                    ["WHERE", "HAVING", "ORDER BY", "LIMIT"],
                    1,
                ),
                (
                    "What does comparing a column to NULL with equals return?",
                    [
                        "True when the column is empty",
                        "Never a match, because NULL equals nothing",
                        "An error",
                        "The same as IS NULL",
                    ],
                    1,
                ),
                (
                    "Why avoid SELECT star in application code?",
                    [
                        "It is slower to parse",
                        "New columns silently change what the query returns",
                        "It is not valid SQL",
                        "It ignores the WHERE clause",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Row or group",
                    "You want courses with more than three modules. Which "
                    "clause holds that count filter? One word.",
                    ["having"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Joins and relationships",
            content="""
Data is split across tables so each fact is stored once. A join is how you put
it back together to answer a question.

An inner join keeps only rows that match on both sides. Courses joined to their
modules gives you every course that has at least one module, and quietly drops
the ones that have none. That silent dropping is the single most common cause of
a report whose totals are slightly wrong.

A left join keeps every row from the left table, and fills the right side with
nulls where there was no match. Courses left joined to modules gives you every
course, including the empty ones. When you want a complete list with extras
attached, left join is almost always what you meant.

The three shapes of relationship cover nearly everything. One to many, where a
course has many modules, is a foreign key on the many side. Many to many, where
a plan covers many courses and a course belongs to many plans, needs a table in
the middle holding the two ids. One to one is rare and usually a sign that two
tables should have been one.

Two traps. Counting after a join counts joined rows, not original rows, so a
course with four modules is counted four times unless you count something
distinct. And querying in a loop, one query per row, is the N plus one problem:
a hundred courses becomes a hundred and one round trips, and it looks fine on
your laptop with three rows of test data.
""",
            quiz=[
                (
                    "You want every course, including ones with no modules. Use:",
                    ["INNER JOIN", "LEFT JOIN", "CROSS JOIN", "UNION"],
                    1,
                ),
                (
                    "A many-to-many relationship needs:",
                    [
                        "A foreign key on each side",
                        "A join table holding both ids",
                        "A unique constraint",
                        "Two one-to-one relationships",
                    ],
                    1,
                ),
                (
                    "What is the N plus one problem?",
                    [
                        "A missing index",
                        "One query per row instead of one query for all rows",
                        "Too many columns in a select",
                        "A join that returns duplicates",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Keeping the empties",
                    "Name the join that keeps rows from the left table even "
                    "when nothing matches. Two words.",
                    ["left join", "left outer join"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Indexes, transactions and staying correct",
            content="""
An index is a second structure the database keeps so it can find rows without
reading the whole table. Without one, filtering a million rows means looking at
a million rows.

Index the columns you filter and join on, especially foreign keys, which people
forget constantly. Index them in the order your queries actually use, because a
compound index on two columns helps a query that filters on the first, and
usually does not help one that filters only on the second. And stop there.
Indexes are not free: every insert and update has to maintain them, so a table
with ten indexes is a table that writes slowly.

The way to know is to ask. Every database can explain a query and tell you
whether it used an index or scanned the table. That answer is data; your
intuition about which query is slow is not.

Transactions are the other half of correctness. A transaction groups statements
so they all happen or none do. The classic example is a transfer: subtract from
one account, add to another. Halfway through is not a state anybody should be
able to observe, and a crash between the two statements without a transaction
loses money.

Transactions also decide what concurrent work sees. The default in PostgreSQL is
read committed, which means you never see another transaction's half-finished
work. Stricter levels exist, and they trade concurrency for guarantees. The
important habit is smaller than the theory: keep transactions short, and never
hold one open across a network call to somebody else's service, or you pin a
database connection for as long as they take to answer.
""",
            quiz=[
                (
                    "Why not add an index to every column?",
                    [
                        "Indexes have a row limit",
                        "Every write has to maintain them",
                        "They break foreign keys",
                        "They use no disk but lots of memory",
                    ],
                    1,
                ),
                (
                    "What does a transaction guarantee?",
                    [
                        "The statements run faster",
                        "All of the statements happen, or none do",
                        "Other users are locked out",
                        "The result is cached",
                    ],
                    1,
                ),
                (
                    "How do you find out whether a query used an index?",
                    [
                        "Time it twice",
                        "Ask the database to explain the query",
                        "Check the table size",
                        "Read the schema",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Held too long",
                    "Explain in a sentence why holding a transaction open "
                    "across a call to an external payment provider is a bad "
                    "idea. Mention connection or pool.",
                    ["connection", "pool"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
    ],
)


PHP = CourseSpec(
    title="PHP for the Web",
    description=(
        "The language a large part of the web still runs on. Requests, forms, "
        "databases and safe modern PHP, explained out loud."
    ),
    price_minor=179_900,  # ₹1,799
    list_price_minor=249_900,
    exam_title="PHP Certification",
    modules=[
        ModuleSpec(
            title="How a PHP request works",
            content="""
PHP has one idea at its centre that is different from most other server
languages, and understanding it explains nearly everything else.

A PHP script does not run continuously. A request arrives, the server starts
your script, the script produces a response, and then everything it had in
memory is thrown away. The next request starts clean. This is called the shared
nothing model, and it is why PHP is unusually forgiving: a script that leaks
memory or leaves a variable in a strange state affects exactly one request.

That model shapes how state is handled. Anything that has to survive between
requests goes somewhere outside the script: a database, a cache, or a session,
which is itself just a small store keyed by a cookie the browser sends back.
There is no long-lived object graph sitting in memory the way there is in a Node
or Java server.

The request itself arrives as data. Query string values, submitted form fields,
uploaded files, cookies and server metadata each arrive in their own place, and
knowing which is which matters, because they carry very different levels of
trust. Everything from the browser is input from a stranger, including headers
and cookies that look like they came from you.

Modern PHP is worth insisting on. Declare strict types at the top of a file so a
string is not silently accepted where a number was wanted. Type your function
parameters and return values. Use the current version. Most of PHP's reputation
was earned by code written for a version that has been unsupported for a decade.
""",
            quiz=[
                (
                    "What happens to a PHP script's memory after a request?",
                    [
                        "It is kept for the next request",
                        "It is discarded; the next request starts clean",
                        "It is written to disk",
                        "It is shared between users",
                    ],
                    1,
                ),
                (
                    "Where does state that must survive between requests live?",
                    [
                        "In a global variable",
                        "In a database, cache or session store",
                        "In the script file",
                        "In the response headers",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "The model",
                    "What is PHP's request model called, where nothing is kept "
                    "in memory between requests? Two words.",
                    ["shared nothing"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Types, arrays and functions",
            content="""
PHP's array is really two things wearing one name: an ordered list, and a map
from keys to values. The same syntax builds both, which is convenient and
occasionally confusing, because a list is just a map whose keys happen to be
consecutive numbers.

The functions you will use constantly are the ones that transform a whole array
at once rather than looping. One maps every element through a function. One
keeps only the elements that pass a test. One reduces a list to a single value.
Reaching for those instead of a loop makes the intent readable at a glance,
which is the point.

Comparison is where PHP earns its reputation, and the fix is one character. The
double equals operator compares loosely and will convert types to find
agreement, which produces surprises that have been the subject of security
advisories. The triple equals operator compares value and type. Use triple
equals by default and reach for loose comparison only when you can say out loud
why.

Null handling has improved enormously and is worth learning. The null coalescing
operator gives a fallback when something is null or missing, which replaces most
of the isset checks older code is full of. The nullsafe operator lets you reach
through a possibly-null object without a nest of conditionals.

Functions should say what they take and what they give back. Type declarations
are optional in PHP and you should use them anyway, because a type error caught
at the boundary is a bug that never reaches a customer.
""",
            quiz=[
                (
                    "What is a PHP array, structurally?",
                    [
                        "A fixed-length list",
                        "An ordered map, which also serves as a list",
                        "A linked list",
                        "A string of bytes",
                    ],
                    1,
                ),
                (
                    "Which comparison operator should you reach for by default?",
                    [
                        "Double equals, for flexibility",
                        "Triple equals, which compares value and type",
                        "The spaceship operator",
                        "It makes no difference",
                    ],
                    1,
                ),
                (
                    "What does the null coalescing operator do?",
                    [
                        "Throws when a value is null",
                        "Supplies a fallback when a value is null or missing",
                        "Converts null to zero",
                        "Removes null items from an array",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Strict comparison",
                    "Which comparison operator checks value AND type in PHP? "
                    "Write the operator.",
                    ["===", "triple equals"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Forms, input and the database",
            content="""
Almost every PHP application does the same three things: take input from a form,
put something in a database, and read it back. Each of those steps has one way
to do it safely and several ways that have caused real breaches.

Start with the rule that everything from the browser is untrusted. Not just
obviously user-typed fields, but hidden inputs, cookies, headers and the URL.
Validate on arrival: check the shape, the length and the range, and reject what
does not fit rather than trying to repair it. Client-side validation is a
courtesy to the person filling in the form. It is not security, because anybody
can send the request directly.

Talking to the database has exactly one correct pattern: prepared statements
with bound parameters. You write the query with placeholders, then hand the
values over separately, and the database never confuses data with instructions.
Building a query by joining strings is SQL injection, it is the oldest hole on
the web, and no amount of escaping by hand is a substitute.

Coming back out, the rule reverses. When you put a value into a page, escape it
for HTML, so a comment containing a script tag is displayed rather than
executed. That is cross-site scripting, and the defence is to escape at the
point of output, every time, rather than trying to clean the data on the way in.

Two more habits. Store passwords with the language's password hashing function,
never a plain hash, and never anything you invented. And for any form that
changes something, include a token that proves the request came from your own
page, so another site cannot make the browser submit it on the visitor's behalf.
""",
            quiz=[
                (
                    "What prevents SQL injection?",
                    [
                        "Escaping quotes by hand",
                        "Prepared statements with bound parameters",
                        "Validating on the client",
                        "Using a longer password",
                    ],
                    1,
                ),
                (
                    "Where should you escape a value to prevent cross-site scripting?",
                    [
                        "On the way into the database",
                        "At the point where it is output into the page",
                        "In the browser",
                        "In the web server configuration",
                    ],
                    1,
                ),
                (
                    "Client-side validation is:",
                    [
                        "A security control",
                        "A convenience for the user, not security",
                        "Enough on its own for simple forms",
                        "Required by PHP",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Data, not instructions",
                    "Name the database technique that keeps user input from "
                    "being treated as SQL. Two words.",
                    ["prepared statement", "prepared statements"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Structure, Composer and deployment",
            content="""
A PHP application grows out of single files quickly, and the tools that manage
that growth are standard across the ecosystem now.

Composer is the dependency manager. It reads a file listing what your project
needs, installs those packages, and generates an autoloader so classes load when
they are first used rather than being included by hand. A lock file records the
exact versions that were installed, and committing it is what makes your machine
and the server agree.

Namespaces keep class names from colliding, and the community convention maps a
namespace onto a directory path so a class can be found from its name alone.
Follow it. Fighting the convention means writing your own autoloading rules for
no gain.

Separate the layers. Code that talks to the database should not also decide what
HTML to print, and a template should not run a query. Whether you adopt a
framework or not, that separation is what lets you test the logic without a
browser and change the page without touching the rules.

For deployment, keep configuration out of the code. Database credentials and API
keys belong in the environment, not in a file you commit. Turn error display off
in production and log instead, because a stack trace on a public page tells an
attacker your file paths and library versions. And serve only your public
directory, so a stray backup file in the project root is not downloadable by
anybody who guesses its name.
""",
            quiz=[
                (
                    "What is the point of Composer's lock file?",
                    [
                        "It compresses dependencies",
                        "It records the exact versions installed",
                        "It encrypts credentials",
                        "It speeds up autoloading",
                    ],
                    1,
                ),
                (
                    "Why turn off error display in production?",
                    [
                        "It slows the server",
                        "Stack traces reveal paths and versions to attackers",
                        "It breaks logging",
                        "PHP requires it",
                    ],
                    1,
                ),
                (
                    "Where should database credentials live?",
                    [
                        "In a committed config file",
                        "In the environment",
                        "In the database",
                        "In the template",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Only the front door",
                    "Explain in a sentence why the web server should serve "
                    "only the public directory. Mention public.",
                    ["public"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
    ],
)


JAVA = CourseSpec(
    title="Java Fundamentals",
    description=(
        "The language most large back ends are written in. Types, objects, "
        "collections and modern Java, explained out loud."
    ),
    price_minor=229_900,  # ₹2,299
    list_price_minor=299_900,
    exam_title="Java Fundamentals Certification",
    modules=[
        ModuleSpec(
            title="Types, the compiler and the virtual machine",
            content="""
Java is compiled, but not to machine code. Your source becomes bytecode, and a
virtual machine runs that bytecode on whatever hardware it happens to be
installed on. That indirection is the whole reason the same build runs on a
laptop and a server without being rebuilt.

The compiler is the part you will notice most, because Java checks types before
anything runs. A variable has a declared type, a method states what it accepts
and what it returns, and code that disagrees does not compile. That feels
strict, and it is: the trade is that a large class of mistakes is caught in
seconds rather than at three in the morning in production.

There are two families of values. Primitives, like whole numbers, decimals and
booleans, hold the value directly. Everything else is an object, and a variable
holding an object holds a reference to it. That distinction explains why
comparing two objects with the equals sign asks whether they are the same
object, not whether they hold the same contents, which is one of the first
things everybody gets wrong. To compare contents, call the equals method.

Strings are objects and they are immutable. Every operation that appears to
change a string actually produces a new one, which is why building a long string
by adding in a loop is slow, and why there is a dedicated builder for that job.

Memory is managed for you. A garbage collector reclaims objects nothing refers
to any more. You do not free anything by hand, but you can still hold on to
things longer than you meant, and that is what a memory leak looks like in Java.
""",
            quiz=[
                (
                    "What does the Java compiler produce?",
                    [
                        "Machine code for the current CPU",
                        "Bytecode for a virtual machine",
                        "An interpreted script",
                        "A container image",
                    ],
                    1,
                ),
                (
                    "Comparing two objects with the equals sign asks:",
                    [
                        "Whether their contents match",
                        "Whether they are the same object",
                        "Whether they have the same type",
                        "Whether both are non-null",
                    ],
                    1,
                ),
                (
                    "Why is building a long string in a loop slow?",
                    [
                        "Strings are stored on disk",
                        "Strings are immutable, so each step makes a new one",
                        "The compiler cannot optimise loops",
                        "Garbage collection is disabled in loops",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Comparing contents",
                    "Which method compares the CONTENTS of two objects in "
                    "Java? One word.",
                    ["equals"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Classes, interfaces and inheritance",
            content="""
A class is a description of a kind of thing: the data it holds and what it can
do. An object is one of those things, created from the class.

Keep the data private and expose behaviour. That is encapsulation, and it is not
ceremony: a field that anything can change is a field whose value nobody can
reason about. When every change goes through a method, the class can enforce its
own rules, and the day one of those rules changes, there is one place to change
it.

An interface says what something can do without saying how. Anything that
implements it promises those methods exist. This is what lets code depend on a
capability rather than a concrete class, which is what makes it testable: a
service that takes an interface can be handed a real database in production and
a simple fake in a test.

Inheritance, where one class extends another, is the tool people reach for too
early. It couples the child to the parent permanently, and a change in the
parent reaches every descendant. The usual better answer is composition: hold an
instance of the other thing and delegate to it. Inherit when the child genuinely
is a kind of the parent and can be used anywhere the parent can, and prefer
composition otherwise.

Modern Java has quieter ways to say common things. A record declares a small
class whose whole job is to hold values, with the comparison and printing
methods written for you. An enum declares a fixed set of named constants, which
is almost always better than passing strings around and hoping everybody spells
them the same way.
""",
            quiz=[
                (
                    "Why keep fields private?",
                    [
                        "It saves memory",
                        "So the class can enforce its own rules about changes",
                        "It is required by the compiler",
                        "It makes the class faster",
                    ],
                    1,
                ),
                (
                    "What does an interface describe?",
                    [
                        "How something is implemented",
                        "What something can do, without saying how",
                        "The memory layout of an object",
                        "The order methods are called in",
                    ],
                    1,
                ),
                (
                    "When should you prefer composition to inheritance?",
                    [
                        "Never; inheritance is always clearer",
                        "By default, unless the child truly is a kind of the parent",
                        "Only in test code",
                        "Only when the parent is abstract",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "A fixed set",
                    "You need a type that can only hold one of four named "
                    "constants. Which Java construct fits? One word.",
                    ["enum"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Collections, generics and streams",
            content="""
Most real Java is collections work: holding groups of things and doing something
to each of them.

Three shapes cover nearly everything. A list keeps order and allows duplicates.
A set holds each distinct value once and does not promise an order. A map holds
keys pointing at values. Choose by the question you need to answer, not by
habit: if you keep asking whether something is already present, that is a set,
and scanning a list for it every time is the slow version of the same idea.

Generics are how a collection knows what it holds. A list of strings will not
accept a number, and taking something out does not require a cast, because the
compiler already knows. Code written without generics compiles with warnings and
fails at run time instead, which is the trade nobody wants.

Streams describe what you want done to a collection rather than how to loop over
it. You filter, you map each element to something else, you collect the result.
The gain is readability: a stream reads as a sentence about the data, and a loop
reads as instructions you have to simulate in your head. They also make the
intent explicit enough that mistakes stand out.

Null deserves its own warning. A null reference is the most common cause of a
crash in Java, and the modern answer is Optional: a value that either holds
something or explicitly holds nothing, so the caller has to acknowledge the
possibility rather than discovering it. Use it for return values that genuinely
may be absent. Do not use it for fields or parameters, where it adds ceremony
without adding safety.
""",
            quiz=[
                (
                    "You keep asking whether a value is already present. Use:",
                    ["A list", "A set", "An array", "A queue"],
                    1,
                ),
                (
                    "What do generics give you?",
                    [
                        "Faster collections",
                        "Compile-time knowledge of what a collection holds",
                        "Automatic sorting",
                        "Thread safety",
                    ],
                    1,
                ),
                (
                    "What is Optional for?",
                    [
                        "Replacing every field",
                        "Making an absent return value explicit to the caller",
                        "Catching exceptions",
                        "Lazy loading",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Distinct values",
                    "Name the collection type that holds each value once. One "
                    "word.",
                    ["set"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Exceptions, testing and building a service",
            content="""
Things go wrong, and Java makes you decide what to do about it at the point
where it can go wrong.

An exception is thrown when a method cannot do what it promised. You either
handle it, or you declare that it can happen and let the caller deal with it.
The important judgement is which of those is honest. Catching an exception and
doing nothing is the worst option available, because the program continues in a
state its author did not plan for, and the failure resurfaces somewhere with no
connection to its cause.

Catch what you can actually do something about. Log the rest with enough context
to identify the request, and let it travel to a boundary that knows how to turn
it into a response. In a web service, that boundary is usually one handler that
turns any unhandled failure into a clean error, so a customer sees a message and
not a stack trace.

Tests are where Java's strictness pays off, because most of the wiring is
checked before a test runs. Write small tests for the logic, name them after the
behaviour they pin rather than the method they call, and check the boundaries:
the empty list, the value exactly at the limit, the one just past it. A test
that only exercises the happy path documents the code without defending it.

Building and running is standardised. A build tool resolves your dependencies,
compiles, runs the tests and produces a single archive you can run. Keep
configuration in the environment rather than compiled in, so the same artefact
runs in test and production and the only difference is what you hand it.
""",
            quiz=[
                (
                    "What is the worst thing to do with a caught exception?",
                    [
                        "Log it and rethrow",
                        "Swallow it silently and continue",
                        "Wrap it with more context",
                        "Let it reach a boundary handler",
                    ],
                    1,
                ),
                (
                    "A good test name describes:",
                    [
                        "The method being called",
                        "The behaviour being pinned",
                        "The author",
                        "The line number",
                    ],
                    1,
                ),
                (
                    "Why keep configuration in the environment?",
                    [
                        "It compiles faster",
                        "The same build can run in test and production",
                        "It is encrypted automatically",
                        "The compiler requires it",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Silent failure",
                    "Explain in a sentence why catching an exception and doing "
                    "nothing is dangerous. Mention state or continues.",
                    ["state", "continue"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
    ],
)


PYTHON = CourseSpec(
    title="Python Essentials",
    description=(
        "The language of scripts, services and data work. Types, functions, "
        "structure and safe practice, explained out loud."
    ),
    price_minor=179_900,  # ₹1,799
    list_price_minor=239_900,
    exam_title="Python Essentials Certification",
    modules=[
        ModuleSpec(
            title="Values, names and control flow",
            content="""
Python is small at the centre and generous around the edges, which is why people
are productive in it quickly and also why bad habits are easy to keep.

A name in Python is a label attached to a value, not a box holding one. Two
names can point at the same list, and changing it through one is visible through
the other. That single fact explains most of the surprises beginners hit, and it
is worth holding on to.

Values fall into two camps. Immutable ones, like numbers, strings and tuples,
cannot be changed in place; an operation gives you a new value. Mutable ones,
like lists, dictionaries and sets, can be changed, and anybody else holding a
reference sees the change. The classic trap follows directly: never use a
mutable value as a default argument, because the default is created once when
the function is defined and then shared by every call.

Control flow is deliberately plain. Indentation is the block structure, not a
convention, so the shape of the code on the page is the shape the interpreter
sees. Truthiness is worth knowing: empty collections, empty strings and zero all
count as false, which makes conditions read well and occasionally hides a bug
where you meant to check for absence and matched emptiness instead.

Errors are exceptions, and asking forgiveness rather than permission is the
normal style. Try the thing, catch the specific failure you expect. Catching
every exception indiscriminately hides bugs, including the keyboard interrupt
somebody is pressing to make it stop.
""",
            quiz=[
                (
                    "Why is a mutable default argument dangerous?",
                    [
                        "It uses more memory",
                        "It is created once and shared by every call",
                        "It cannot be typed",
                        "It slows the function down",
                    ],
                    1,
                ),
                (
                    "Which of these is immutable?",
                    ["List", "Dictionary", "Tuple", "Set"],
                    2,
                ),
                (
                    "Why avoid catching every exception?",
                    [
                        "It is slower",
                        "It hides bugs and swallows interrupts",
                        "It is not allowed in functions",
                        "It breaks the traceback",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "The shared default",
                    "Name one type you should never use as a default argument "
                    "value in Python. One word.",
                    ["list", "dict", "dictionary", "set"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Data structures that fit the problem",
            content="""
Choosing the right structure is most of the performance work you will ever do in
Python, and it is a design decision rather than an optimisation.

A list keeps order and allows duplicates, and finding a value in one means
looking through it. A set holds distinct values with no order, and asking
whether something is in it is effectively instant. A dictionary maps keys to
values with the same instant lookup. A tuple is a fixed group of values that
belong together, and being immutable, it can be a dictionary key.

The single most common performance mistake is checking membership against a
list inside a loop. That is a scan for every iteration, and turning the list
into a set beforehand changes the shape of the work entirely. It is one line,
and on a large enough input it is the difference between seconds and hours.

Comprehensions are the idiomatic way to build a new collection from an existing
one. They read as a description of the result rather than a procedure for
assembling it, and they keep the intermediate variables out of your scope. Keep
them to one level of nesting; a comprehension you have to read twice has stopped
earning its place, and a loop is clearer.

When a structure starts growing methods and rules, promote it. A dictionary
being passed around with a fixed set of keys is a class waiting to happen, and a
dataclass gives you one in three lines, with comparison and printing included and
the field names checked by your editor rather than by hope.
""",
            quiz=[
                (
                    "You check membership repeatedly in a loop. Convert the list to:",
                    ["A tuple", "A set", "A string", "A generator"],
                    1,
                ),
                (
                    "Why can a tuple be a dictionary key when a list cannot?",
                    [
                        "Tuples are shorter",
                        "Tuples are immutable, so they hash consistently",
                        "Lists are unordered",
                        "Lists take more memory",
                    ],
                    1,
                ),
                (
                    "A dictionary passed around with a fixed set of keys is usually:",
                    [
                        "Correct as it is",
                        "Better expressed as a class or dataclass",
                        "A sign of good design",
                        "Faster than an object",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Fast membership",
                    "Which structure makes 'is this value present' effectively "
                    "instant? One word.",
                    ["set"],
                    MatchMode.EXACT,
                ),
            ],
        ),
        ModuleSpec(
            title="Functions, modules and type hints",
            content="""
A function should do one thing and its name should say what. If you cannot name
it without using the word and, it is probably two functions.

Prefer arguments to globals, and prefer returning a value to changing something
in place. A function that takes what it needs and gives back a result can be
tested with no setup and reasoned about without reading anything else. A
function that reaches out to module-level state can only be understood by
reading the whole file.

Modules are just files, and packages are directories of them. Keep imports at
the top, import specific names rather than everything, and avoid circular
imports by noticing what they are telling you: two modules that need each other
usually contain one idea that belongs in a third.

Type hints are optional and you should use them anyway. They do not change how
the program runs; they let a checker tell you that a function returning a string
or nothing is being used as though it always returned a string. On a codebase of
any size, that catches a steady stream of real bugs, and it makes the code
readable without running it.

Two more habits worth forming. Write docstrings that say why rather than
restating the signature, because the signature is already there. And use a
virtual environment per project, so two projects that need different versions of
the same library can coexist, which they will.
""",
            quiz=[
                (
                    "A function you cannot name without 'and' is usually:",
                    [
                        "Well factored",
                        "Two functions",
                        "Too short",
                        "Missing a return type",
                    ],
                    1,
                ),
                (
                    "What do type hints do at run time?",
                    [
                        "Enforce the types",
                        "Nothing; a separate checker uses them",
                        "Convert values",
                        "Slow the program down",
                    ],
                    1,
                ),
                (
                    "A circular import usually means:",
                    [
                        "The files are too long",
                        "A shared idea belongs in a third module",
                        "Imports are in the wrong order",
                        "Python needs a newer version",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Isolated dependencies",
                    "What should you create per project so two projects can "
                    "use different library versions? Two words.",
                    ["virtual environment", "virtualenv", "venv"],
                    MatchMode.CONTAINS,
                ),
            ],
        ),
        ModuleSpec(
            title="Files, the outside world and safe practice",
            content="""
Programs that only touch their own variables are rare. Most of the work is
reading something, calling something, and writing something back, and each of
those is a place where the world can be different from what you assumed.

Open files with a context manager so they are closed even when something throws.
That is what the with statement is for, and it applies to far more than files:
database connections, locks and network sessions all use the same pattern.
Anything you have to remember to close is something you should be handing to a
context manager instead.

Text has an encoding, and the moment you skip saying which one, your program
works on your machine and fails on somebody else's. Be explicit, and prefer UTF
eight. The same care applies to paths: build them with the path tools rather
than by joining strings, so your code runs on a system that uses different
separators.

Talking to the network means accepting that it fails. Always set a timeout,
because a request without one can hang until somebody restarts the process.
Decide in advance what a failure means: retry a temporary one, and give up
loudly on a permanent one rather than pretending it succeeded.

Finally, the boring safety rules that matter most. Never build a shell command
by joining strings with user input. Never put credentials in the source; read
them from the environment. Validate anything that arrives from outside before
you act on it. And when you log, log what happened rather than the payload,
because a log file is a place secrets go to live forever.
""",
            quiz=[
                (
                    "What does the with statement guarantee?",
                    [
                        "Faster file access",
                        "The resource is closed even if an error is raised",
                        "The file is read in one go",
                        "The file is locked",
                    ],
                    1,
                ),
                (
                    "Why always set a timeout on a network request?",
                    [
                        "It reduces bandwidth",
                        "Without one the call can hang indefinitely",
                        "It is required by HTTP",
                        "It improves security headers",
                    ],
                    1,
                ),
                (
                    "Credentials should be read from:",
                    [
                        "A committed config file",
                        "The environment",
                        "The database",
                        "A constant at the top of the file",
                    ],
                    1,
                ),
            ],
            assignments=[
                (
                    "Closed either way",
                    "Which Python statement makes sure a file is closed even "
                    "when an error is raised? One word.",
                    ["with"],
                    MatchMode.EXACT,
                ),
            ],
        ),
    ],
)


#: Every course the seed knows about, in the order the catalogue lists them.
#:
#: The seed reads this; the stack bundles in seed.py reference courses by title
#: and are checked against it, so a bundle naming a course that is not here
#: fails loudly at seed time rather than silently shipping a bundle with a hole
#: in it.
CATALOGUE: list[CourseSpec] = [
    JAVASCRIPT,
    HTML_CSS,
    REACT,
    TYPESCRIPT,
    PYTHON,
    PHP,
    NODE,
    POSTGRESQL,
    NEXTJS,
    JAVA,
    CLOUD,
]
