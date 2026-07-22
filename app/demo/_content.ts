/**
 * "Learn with AI" demo catalog — two hand-authored course fixtures used to test the public,
 * unauthenticated demo pages at test.hello-clio.com/demo. Content is original (not copied from any
 * real course provider); only the page layout/styling takes inspiration from a course-catalog UI.
 */

export interface ContentBlock {
  type: 'paragraph' | 'code' | 'list'
  text?: string
  code?: string
  language?: string
  items?: string[]
}

export interface Chapter {
  id: string
  title: string
  durationLabel: string
  blocks: ContentBlock[]
}

export interface DemoTopic {
  slug: string
  demoLabel: string
  title: string
  subtitle: string
  author: string
  authorRole: string
  durationLabel: string
  level: string
  rating: number
  ratingCount: number
  updatedLabel: string
  category: string
  overview: string
  chapters: Chapter[]
}

export const DEMO_TOPICS: DemoTopic[] = [
  {
    slug: 'claude-ai',
    demoLabel: 'Demo 1',
    title: 'Claude AI: Models & Capabilities',
    subtitle: 'Understand the Claude model family and how to pick the right one for the job',
    author: 'Learn with AI',
    authorRole: 'Course Team',
    durationLabel: '45m',
    level: 'Beginner',
    rating: 4.8,
    ratingCount: 312,
    updatedLabel: 'July 2026',
    category: 'AI Fundamentals',
    overview:
      'A practical, non-technical introduction to Claude — what it is, how the model family is organized, the different ways you can interact with it, and how to choose the right model for a given task. No prior AI experience required.',
    chapters: [
      {
        id: 'what-is-claude',
        title: 'What Is Claude?',
        durationLabel: '5m',
        blocks: [
          {
            type: 'paragraph',
            text: 'Claude is a family of large language models built by Anthropic, designed to be helpful, honest, and safe. At its core, Claude takes text (and often images, documents, or code) as input and generates text as output — but what makes it useful in practice is the range of things it can do with that: answer questions, write and edit code, analyze documents, hold a conversation, and act as an agent that plans and carries out multi-step tasks using tools.',
          },
          {
            type: 'paragraph',
            text: "Anthropic was founded with a specific focus on AI safety, and that shows up in how Claude is trained: it's built to be careful about the claims it makes, to say when it isn't sure, and to avoid producing harmful content — while still being genuinely capable at demanding, real-world work.",
          },
        ],
      },
      {
        id: 'model-family',
        title: 'The Claude Model Family',
        durationLabel: '10m',
        blocks: [
          {
            type: 'paragraph',
            text: 'Claude isn\'t a single model — it\'s a family, released in generations. The current generation is "Claude 5," which includes several models sized differently for different tradeoffs between capability, speed, and cost:',
          },
          {
            type: 'list',
            items: [
              'Opus — the most capable model in the family, built for the hardest reasoning, research, and creative work where quality matters more than speed or cost.',
              'Sonnet — a balanced model tuned for everyday work: coding, writing, analysis, and agentic tasks, with strong capability at a fraction of Opus\'s cost and latency.',
              'Haiku — the fastest and most cost-efficient model, built for high-volume, latency-sensitive use cases like chat interfaces, classification, and simple automation.',
              'Fable — a model variant tuned for narrative and creative use cases within the same family.',
            ],
          },
          {
            type: 'paragraph',
            text: 'Each new generation (Claude 3 → Claude 4 → Claude 5) generally improves capability at every size tier, so a current-generation Haiku can often outperform an older-generation Opus on many tasks — size and generation both matter.',
          },
        ],
      },
      {
        id: 'modes-of-interaction',
        title: 'Modes of Interaction',
        durationLabel: '8m',
        blocks: [
          {
            type: 'paragraph',
            text: 'The same underlying models show up in different "modes" depending on how you use them:',
          },
          {
            type: 'list',
            items: [
              'Conversational chat — a back-and-forth dialogue, the most familiar way people interact with Claude (claude.ai, apps built on the API).',
              'Extended thinking — for hard problems, Claude can be given more room to reason step by step before answering, trading extra time for better answers on complex tasks.',
              'Agentic use — instead of just answering, Claude can be given tools (a terminal, a browser, a codebase, an API) and asked to plan and execute a multi-step task on its own, checking its own work along the way. Claude Code and the Claude Agent SDK are built around this mode.',
              'Embedded/integrated — Claude also shows up inside other products (like Claude in Slack), answering questions or taking action in the context where people already work.',
            ],
          },
        ],
      },
      {
        id: 'choosing-the-right-model',
        title: 'Choosing the Right Model for the Job',
        durationLabel: '12m',
        blocks: [
          {
            type: 'paragraph',
            text: "There's no single \"best\" model — the right choice depends on what you're optimizing for:",
          },
          {
            type: 'list',
            items: [
              'Deep research, hard math/reasoning, high-stakes writing → Opus. You want the strongest reasoning available and can afford to wait a bit longer and pay more per response.',
              'Day-to-day coding, agents, document analysis, most product features → Sonnet. This is usually the default: strong capability, reasonable cost, low enough latency for interactive use.',
              'High-volume classification, simple chat, real-time features → Haiku. When you\'re making thousands or millions of calls and need speed and low cost more than maximum reasoning depth.',
              'Creative/narrative generation → Fable, when the task is specifically about storytelling or creative writing rather than technical work.',
            ],
          },
          {
            type: 'paragraph',
            text: "A common pattern in production systems is to mix models: use a fast, cheap model like Haiku to triage or pre-process, and only escalate to Sonnet or Opus for the subset of requests that actually need deeper reasoning.",
          },
        ],
      },
      {
        id: 'what-makes-claude-different',
        title: 'What Makes Claude Different',
        durationLabel: '10m',
        blocks: [
          {
            type: 'paragraph',
            text: "A few things consistently show up as differentiators when people compare Claude to other AI models:",
          },
          {
            type: 'list',
            items: [
              'Safety-first training — Claude is trained to be careful, to decline harmful requests, and to be transparent about uncertainty rather than confidently making things up.',
              'Long context windows — Claude can hold very large amounts of text (entire codebases, long documents, extended conversations) in context at once, which matters for real-world work that doesn\'t fit in a short prompt.',
              'Strong agentic tool use — Claude is specifically good at using tools reliably across many steps, which is what makes products like Claude Code possible: an agent that can read a codebase, make a plan, and execute it.',
              'Artifacts and structured output — Claude can produce and iterate on substantial standalone outputs (code, documents, interactive UIs) rather than just replying in plain chat text.',
            ],
          },
        ],
      },
    ],
  },
  {
    slug: 'oop-fundamentals',
    demoLabel: 'Demo 2',
    title: 'Object-Oriented Programming Fundamentals',
    subtitle: 'Classes, objects, and the four pillars of OOP — with real code and real-world reasoning',
    author: 'Learn with AI',
    authorRole: 'Course Team',
    durationLabel: '1h 16m',
    level: 'Intermediate',
    rating: 4.9,
    ratingCount: 587,
    updatedLabel: 'July 2026',
    category: 'Programming Languages',
    overview:
      'A technically deep, code-first walkthrough of object-oriented programming: what problems it solves, how classes and objects actually work under the hood, and each of the four pillars — encapsulation, abstraction, inheritance, and polymorphism — with runnable Python examples and an explanation of why each concept matters in real production systems, not just in theory.',
    chapters: [
      {
        id: 'why-oop',
        title: 'Why Object-Oriented Programming?',
        durationLabel: '8m',
        blocks: [
          {
            type: 'paragraph',
            text: "Object-oriented programming (OOP) is a way of structuring code around data and the behavior that belongs to it, instead of writing a long sequence of standalone functions that all reach into shared, loosely-related state. In OOP, you model a problem as a set of objects — each bundling its own data (attributes) with the operations that make sense on that data (methods).",
          },
          {
            type: 'paragraph',
            text: 'The practical payoff shows up as systems grow: OOP gives you natural units for code reuse (a class you can instantiate many times), a place to enforce rules about how data can be changed (methods, not direct access), and a vocabulary that maps onto how teams actually talk about a domain — a "Customer," an "Order," a "PaymentMethod" — which makes large codebases easier to reason about and safer to change as more people work on them.',
          },
        ],
      },
      {
        id: 'classes-and-objects',
        title: 'Classes and Objects',
        durationLabel: '12m',
        blocks: [
          {
            type: 'paragraph',
            text: 'A class is a blueprint; an object is a specific instance built from that blueprint. The class defines what attributes and methods every instance will have — each object gets its own copy of the attribute values.',
          },
          {
            type: 'code',
            language: 'python',
            code: `class Car:
    def __init__(self, make, model, year):
        self.make = make
        self.model = model
        self.year = year
        self.odometer = 0

    def drive(self, miles):
        self.odometer += miles

my_car = Car("Toyota", "Corolla", 2024)
your_car = Car("Honda", "Civic", 2023)

my_car.drive(120)

print(my_car.odometer)    # 120
print(your_car.odometer)  # 0 — separate state per object`,
          },
          {
            type: 'paragraph',
            text: 'Two things to notice: \\_\\_init\\_\\_ is the constructor — it runs once, when the object is created, and sets up its starting state. And self refers to "this specific instance," which is how each object keeps its own odometer without affecting any other Car object.',
          },
        ],
      },
      {
        id: 'encapsulation',
        title: 'Encapsulation',
        durationLabel: '12m',
        blocks: [
          {
            type: 'paragraph',
            text: "Encapsulation means bundling data with the methods that operate on it, and controlling access to that data so it can only change in valid ways — instead of letting any part of the program reach in and mutate it directly.",
          },
          {
            type: 'code',
            language: 'python',
            code: `class BankAccount:
    def __init__(self, owner, balance=0):
        self.owner = owner
        self._balance = balance   # convention: internal, not part of the public API

    def deposit(self, amount):
        if amount <= 0:
            raise ValueError("Deposit must be positive")
        self._balance += amount

    def withdraw(self, amount):
        if amount > self._balance:
            raise ValueError("Insufficient funds")
        self._balance -= amount

    def get_balance(self):
        return self._balance

account = BankAccount("Arun", 1000)
account.deposit(500)
account.withdraw(200)
print(account.get_balance())   # 1300

# account._balance = 1_000_000   # possible in Python, but a signal you're
                                  # bypassing the class's own rules`,
          },
          {
            type: 'paragraph',
            text: "Why it matters in the real world: without encapsulation, any code anywhere in a large system can set balance to an invalid value — negative, wrong currency, out of sync with a ledger — because there's no single place enforcing the rules. With it, deposit() and withdraw() are the only doors in, so validation and business rules live in exactly one place, which is what makes large codebases safe to change without breaking invariants you didn't even know existed.",
          },
        ],
      },
      {
        id: 'abstraction',
        title: 'Abstraction',
        durationLabel: '10m',
        blocks: [
          {
            type: 'paragraph',
            text: "Abstraction means exposing what an object does, while hiding how it does it. Callers depend on a simple, stable interface; the implementation behind that interface is free to change without breaking anything that uses it.",
          },
          {
            type: 'code',
            language: 'python',
            code: `from abc import ABC, abstractmethod

class PaymentProcessor(ABC):
    @abstractmethod
    def charge(self, amount):
        ...

class StripeProcessor(PaymentProcessor):
    def charge(self, amount):
        print(f"Charging \${amount} via Stripe")

class PayPalProcessor(PaymentProcessor):
    def charge(self, amount):
        print(f"Charging \${amount} via PayPal")

def checkout(processor: PaymentProcessor, amount):
    # This function doesn't know or care which payment provider it's using —
    # it only depends on the abstract "charge" interface.
    processor.charge(amount)

checkout(StripeProcessor(), 49.99)
checkout(PayPalProcessor(), 49.99)`,
          },
          {
            type: 'paragraph',
            text: "Why it matters in the real world: this is exactly how you add a new payment provider — say Apple Pay — to a live system without touching checkout(), or any other code that calls it. You write one new class that implements the same interface, and every existing caller keeps working unchanged. Abstraction is what lets a large team add features in parallel without stepping on each other.",
          },
        ],
      },
      {
        id: 'inheritance',
        title: 'Inheritance',
        durationLabel: '14m',
        blocks: [
          {
            type: 'paragraph',
            text: 'Inheritance lets one class (a subclass) reuse and extend the attributes and methods of another (a base class), modeling an "is-a" relationship — a Dog is an Animal, a Car is a Vehicle.',
          },
          {
            type: 'code',
            language: 'python',
            code: `class Animal:
    def __init__(self, name):
        self.name = name

    def describe(self):
        return f"{self.name} is an animal."

    def speak(self):
        raise NotImplementedError("Subclasses must implement speak()")

class Dog(Animal):
    def speak(self):
        return f"{self.name} says Woof!"

class Cat(Animal):
    def speak(self):
        return f"{self.name} says Meow!"

pets = [Dog("Rex"), Cat("Milo")]
for pet in pets:
    print(pet.describe())   # inherited from Animal, unchanged
    print(pet.speak())      # overridden per subclass`,
          },
          {
            type: 'paragraph',
            text: "Why it matters in the real world: inheritance avoids copy-pasting shared logic across every related class — describe() is written once, in Animal, and every subclass gets it for free. Used well, this cuts down duplicated code and centralizes bug fixes (fix describe() once, every animal benefits); used carelessly (deep, tangled hierarchies), it can make code harder to follow, which is why many teams today prefer composition for some cases — a topic for a follow-up course.",
          },
        ],
      },
      {
        id: 'polymorphism',
        title: 'Polymorphism',
        durationLabel: '12m',
        blocks: [
          {
            type: 'paragraph',
            text: 'Polymorphism means code can call the same method on different types of objects, and each object responds with its own correct behavior — the caller doesn\'t need to know or check which concrete type it\'s dealing with.',
          },
          {
            type: 'code',
            language: 'python',
            code: `class Shape:
    def area(self):
        raise NotImplementedError

class Rectangle(Shape):
    def __init__(self, width, height):
        self.width = width
        self.height = height

    def area(self):
        return self.width * self.height

class Circle(Shape):
    def __init__(self, radius):
        self.radius = radius

    def area(self):
        return 3.14159 * self.radius ** 2

shapes = [Rectangle(4, 5), Circle(3)]

total_area = sum(shape.area() for shape in shapes)
print(total_area)   # works without a single if/elif checking the type`,
          },
          {
            type: 'paragraph',
            text: "Why it matters in the real world: without polymorphism, code that needs to handle multiple types ends up full of if isinstance(shape, Rectangle) ... elif isinstance(shape, Circle) ... branches — and every time a new shape is added, every one of those branches across the codebase needs updating. With polymorphism, adding a new Shape subclass is enough; every existing loop that calls .area() automatically handles it correctly, with zero changes.",
          },
        ],
      },
      {
        id: 'oop-in-the-real-world',
        title: 'OOP in the Real World',
        durationLabel: '8m',
        blocks: [
          {
            type: 'paragraph',
            text: "Put together, the four pillars aren't academic labels — they're the reason large, long-lived codebases stay maintainable. Encapsulation keeps invalid states from leaking in from anywhere in the program. Abstraction lets a system's pieces evolve independently as long as their interfaces stay stable. Inheritance and polymorphism let you add new variations of an existing concept (a new payment method, a new shape, a new user role) without rewriting the code that already works.",
          },
          {
            type: 'paragraph',
            text: "This is why OOP shows up everywhere from web frameworks (a Django or Rails \"model\" is a class), to game engines (every game object is typically some kind of Entity subclass), to enterprise systems (an order-processing pipeline built from Order, LineItem, and PaymentMethod classes) — it's a practical tool for keeping complexity manageable as a system and its team both grow.",
          },
        ],
      },
    ],
  },
]

export function getDemoTopicBySlug(slug: string): DemoTopic | undefined {
  return DEMO_TOPICS.find((t) => t.slug === slug)
}
