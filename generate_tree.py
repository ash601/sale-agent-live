import os

def generate_tree(startpath, output_file):
    ignore_dirs = {'.git', 'node_modules', '__pycache__', '.DS_Store', '.gemini', '.vscode', 'dist', 'build', 'coverage'}
    
    with open(output_file, 'w') as f:
        f.write("# Project Structure\n\n")
        
        # Get top-level items
        try:
            items = sorted(os.listdir(startpath))
        except PermissionError:
            return

        # Filter for directories only for the "roots", or include files if they are in root?
        # Requirement: "Root folder is main root - and then all the folder inside it are displayed as the root"
        # This suggests we iterate over immediate children.
        
        for item in items:
            if item in ignore_dirs:
                continue
                
            path = os.path.join(startpath, item)
            if os.path.isdir(path):
                # This is a top-level folder, treat it as a root
                f.write(f"{item}/\n")
                print_tree(path, f, "", ignore_dirs)
                f.write("\n")
            else:
                # It's a file in the root
                f.write(f"{item}\n\n")

def print_tree(dir_path, f, prefix, ignore_dirs):
    try:
        items = sorted(os.listdir(dir_path))
    except PermissionError:
        return
        
    # Filter ignored items
    items = [i for i in items if i not in ignore_dirs]
    
    for index, item in enumerate(items):
        path = os.path.join(dir_path, item)
        is_last = (index == len(items) - 1)
        
        connector = "└── " if is_last else "├── "
        
        f.write(f"{prefix}{connector}{item}\n")
        
        if os.path.isdir(path):
            extension = "    " if is_last else "│   "
            print_tree(path, f, prefix + extension, ignore_dirs)

if __name__ == "__main__":
    root_dir = "."
    output_file = "TREE.md"
    generate_tree(root_dir, output_file)
    print(f"Tree generated in {output_file}")
