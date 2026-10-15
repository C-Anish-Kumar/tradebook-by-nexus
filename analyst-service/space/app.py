# Hugging Face Space entry point: the service itself is installed from requirements.txt
try:
    # Free Gradio Spaces now default to ZeroGPU, which refuses to start an app without a
    # @spaces.GPU function. The analysis runs on CPU; this no-op only satisfies that check.
    import spaces

    @spaces.GPU
    def _zerogpu_placeholder():
        return None
except ImportError:
    pass

from openstock_analyst.server import main

main()
