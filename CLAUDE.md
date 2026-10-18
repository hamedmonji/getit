
## Must follow guidelines

only choose rust if the operation is performance critical, or it can become a performance bottle neck once the scale of the data it operates on increases.

use pure functions, write pure functions over stateful functions as much as possible, keep them out of Ui (.tsx files) and always unit test them.

Always use shadcn components when available.